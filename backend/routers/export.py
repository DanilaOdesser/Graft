"""Export a Graft branch to a Claude Code JSONL session.

POST /nodes/{node_id}/export-claude?launch=true
  - Linearizes the branch from root → node_id (oldest first).
  - Pulls pins + imports for that branch and folds them into a <graft-context>
    preamble prepended to the first user message (Claude Code has no system
    line type — system context goes through the first user turn).
  - Writes the JSONL to ~/.claude/projects/<encoded-cwd>/<session>.jsonl
    with cwd = ~/graft-exports/<conversation_id>.
  - On macOS, optionally spawns Terminal and runs `claude --resume <session>`.
"""
from __future__ import annotations

import json
import platform
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from models.context import ClaudeExport
from models.core import Branch, Node

router = APIRouter()

# Match the version string CC writes today; bumping it has no effect on resume,
# the field is read for telemetry/tooling only.
CC_VERSION = "2.1.132"
DEFAULT_MODEL = "claude-sonnet-4-5"


def _encode_cwd(path: str) -> str:
    """Claude Code encodes the project cwd by replacing '/' with '-'."""
    return path.replace("/", "-")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _token_count(content: str) -> int:
    """Match the formula used by routers/agent.py and routers/conversations.py."""
    return int(len(content.split()) * 1.3)


def _extract_text(message: dict) -> str | None:
    """Pull plain text out of a CC JSONL `message` payload.

    User messages tend to have `content` as a string; assistant messages have
    a list of content blocks. We only round-trip plain text — tool uses,
    thinking blocks, attachments, etc. are dropped.
    """
    content = message.get("content")
    if isinstance(content, str):
        text_value = content.strip()
        return text_value or None
    if isinstance(content, list):
        chunks: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text") or ""
                if t:
                    chunks.append(t)
        joined = "\n".join(chunks).strip()
        return joined or None
    return None


def _read_chat_lines(file_path: Path) -> list[dict]:
    """Read a CC JSONL file and return only user/assistant message dicts in order.

    Skips other line types (file-history-snapshot, attachment, sidechain, etc.)
    and any chat lines whose content can't be reduced to plain text.
    """
    if not file_path.exists():
        return []
    chat: list[dict] = []
    for raw in file_path.read_text().splitlines():
        if not raw.strip():
            continue
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if entry.get("type") not in ("user", "assistant"):
            continue
        if entry.get("isSidechain"):
            continue
        message = entry.get("message") or {}
        text_value = _extract_text(message)
        if text_value is None:
            continue
        chat.append({
            "uuid": entry.get("uuid"),
            "type": entry["type"],
            "text": text_value,
            "timestamp": entry.get("timestamp"),
        })
    return chat


def _find_cc_continuation(export: ClaudeExport) -> Path | None:
    """Locate the JSONL file CC actually wrote to for a given export.

    CC's `--resume` behavior is variable: sometimes it APPENDS new turns to
    the original file in-place; sometimes it creates a NEW file (with a
    fresh sessionId rewritten across every line) that copies the resumed
    history and then appends. We handle both:

    1. The original file (export.file_path) is always a candidate — we
       wrote it, so we know it's ours. If CC appended in-place, the chat
       line count grew past exported_message_count.
    2. Other files in the same project dir that contain
       `<graft-export>{session_id}</graft-export>` in their preamble are
       new-file continuations. The marker survives because CC copies the
       full message content verbatim.

    Pick the candidate with the most chat lines (= longest continuation),
    tie-broken by mtime.
    """
    original = Path(export.file_path)
    project_dir = original.parent
    if not project_dir.is_dir():
        return None
    marker = f"<graft-export>{export.session_id}</graft-export>"

    candidates: list[Path] = []
    if original.exists():
        candidates.append(original)
    for f in project_dir.glob("*.jsonl"):
        if f == original:
            continue
        try:
            blob = f.read_text()
        except OSError:
            continue
        if marker in blob:
            candidates.append(f)
    if not candidates:
        return None

    def score(p: Path) -> tuple[int, float]:
        try:
            text = p.read_text()
        except OSError:
            return (-1, 0.0)
        chat_count = sum(
            1
            for line in text.splitlines()
            if line.strip()
            and (j := _safe_json(line))
            and j.get("type") in ("user", "assistant")
            and not j.get("isSidechain")
        )
        return (chat_count, p.stat().st_mtime)

    return max(candidates, key=score)


def _safe_json(line: str) -> dict | None:
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def _sync_branch_from_cc(db: Session, branch: Branch) -> int:
    """Append any new CC turns from prior exports of this branch as Graft nodes.

    Returns the number of nodes inserted across all prior sessions for the
    branch. Branch.head_node_id is advanced as nodes are added.
    """
    prior = (
        db.query(ClaudeExport)
        .filter(ClaudeExport.branch_id == branch.id)
        .order_by(ClaudeExport.exported_at.asc())
        .all()
    )
    inserted_total = 0
    for export in prior:
        cc_file = _find_cc_continuation(export)
        if cc_file is None:
            continue
        chat = _read_chat_lines(cc_file)
        # Lines we wrote on export are at the start of the continuation; CC
        # appends new turns at the end.
        new_lines = chat[export.exported_message_count:]
        if not new_lines:
            continue
        for entry in new_lines:
            new_node = Node(
                id=uuid.uuid4(),
                conversation_id=branch.conversation_id,
                parent_id=branch.head_node_id,
                branch_id=branch.id,
                node_type="message",
                role=entry["type"],  # 'user' or 'assistant'
                content=entry["text"],
                token_count=_token_count(entry["text"]),
            )
            db.add(new_node)
            db.flush()
            branch.head_node_id = new_node.id
            inserted_total += 1
        # Mark the whole file as imported so a re-click is a no-op until CC
        # adds more turns. Bump exported_message_count to the new total so
        # subsequent syncs only see *new* CC turns.
        export.exported_message_count = len(chat)
        export.last_imported_uuid = new_lines[-1]["uuid"]
        export.last_imported_at = datetime.now(timezone.utc)
    return inserted_total


def _build_preamble(system_chunks: list[str], pin_contents: list[str], import_contents: list[str], export_id: str) -> str:
    # The export marker lets us trace `claude --resume` continuations back
    # to this session — CC creates a new JSONL with a new sessionId on
    # resume but copies the full message history (including this preamble)
    # verbatim, so the marker travels with the conversation.
    parts: list[str] = [f"<graft-export>{export_id}</graft-export>"]
    if system_chunks:
        parts.append("<graft-system>\n" + "\n\n".join(system_chunks) + "\n</graft-system>")
    if pin_contents:
        parts.append("<graft-pinned>\n" + "\n\n---\n\n".join(pin_contents) + "\n</graft-pinned>")
    if import_contents:
        parts.append("<graft-imported>\n" + "\n\n---\n\n".join(import_contents) + "\n</graft-imported>")
    return "<graft-context>\n" + "\n\n".join(parts) + "\n</graft-context>\n\n"


@router.post("/branches/{branch_id}/sync-claude")
def sync_branch_from_claude(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    """Pull any new CC turns from prior export sessions into the branch.

    Same logic as the implicit sync that happens at the start of /export-claude,
    but standalone — no re-export, no Terminal launch. The frontend exposes
    this as a "Sync from Claude" button so the user can refresh after chatting
    in CC without re-launching a session.
    """
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="branch not found")
    synced = _sync_branch_from_cc(db, branch)
    if synced:
        db.commit()
    else:
        db.rollback()
    return {
        "branch_id": str(branch.id),
        "head_node_id": str(branch.head_node_id) if branch.head_node_id else None,
        "synced_from_claude": synced,
    }


@router.post("/nodes/{node_id}/export-claude")
def export_to_claude_code(
    node_id: uuid.UUID,
    launch: bool = False,
    db: Session = Depends(get_db),
):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="node not found")

    branch = db.query(Branch).filter(Branch.id == node.branch_id).first()
    if not branch:
        raise HTTPException(status_code=500, detail="orphan node — no branch")

    # Round-trip step: pull in any new turns the user added in CC for prior
    # exports of this branch. Each → Claude click is a checkpoint.
    old_head_id = branch.head_node_id
    synced_count = _sync_branch_from_cc(db, branch)
    if synced_count and node.id == old_head_id:
        # User clicked the (then-)head; bump the export start point so the
        # new session resumes from the latest state instead of pre-CC.
        node = db.query(Node).filter(Node.id == branch.head_node_id).first()
        node_id = node.id
    if synced_count:
        db.flush()

    # Ancestors from root → node, oldest first.
    rows = db.execute(
        text(
            """
            SELECT n.id, n.role, n.content, n.node_type, na.depth
            FROM node_ancestry na
            JOIN nodes n ON n.id = na.ancestor_id
            WHERE na.descendant_id = :node_id
            ORDER BY na.depth DESC
            """
        ),
        {"node_id": str(node_id)},
    ).mappings().all()

    # Pins on the node's branch, highest priority first.
    pins = db.execute(
        text(
            """
            SELECT n.content
            FROM context_pins cp
            JOIN nodes n ON n.id = cp.node_id
            WHERE cp.branch_id = :branch_id
            ORDER BY cp.priority DESC, cp.created_at ASC
            """
        ),
        {"branch_id": str(node.branch_id)},
    ).mappings().all()

    # Imports on the node's branch (with descendants when ci.include_descendants).
    imports = db.execute(
        text(
            """
            SELECT DISTINCT n.id, n.content
            FROM context_imports ci
            JOIN node_ancestry na
              ON na.ancestor_id = ci.source_node_id
             AND (ci.include_descendants OR na.descendant_id = ci.source_node_id)
            JOIN nodes n ON n.id = na.descendant_id
            WHERE ci.target_branch_id = :branch_id
            """
        ),
        {"branch_id": str(node.branch_id)},
    ).mappings().all()

    system_chunks = [r["content"] for r in rows if r["role"] == "system"]

    # Commit/summary nodes have role=NULL and node_type='summary'.  Their
    # content is "{commit_message}\n\n{raw_transcript}" — inject them as
    # [Committed context] blocks in the preamble, same as call_llm does, so
    # the exported session has the full committed history.
    system_chunks += [
        f"[Committed context]\n{r['content']}"
        for r in rows
        if r["node_type"] == "summary"
    ]

    # Only user/assistant turns become JSONL lines; system + summary nodes
    # live in the preamble.
    chat_rows = [r for r in rows if r["role"] in ("user", "assistant")]
    if not chat_rows:
        raise HTTPException(
            status_code=400,
            detail="branch has no user/assistant messages yet — nothing to export",
        )

    # Claude Code requires the first message to be `user`. If our chain
    # starts with `assistant` (shouldn't happen for normal seed flows but is
    # possible for hand-crafted trees), prepend an empty user marker.
    if chat_rows[0]["role"] != "user":
        chat_rows = [{"role": "user", "content": "(continuation from Graft)"}] + list(chat_rows)

    session_id = str(uuid.uuid4())
    preamble = _build_preamble(
        system_chunks=system_chunks,
        pin_contents=[p["content"] for p in pins],
        import_contents=[i["content"] for i in imports],
        export_id=session_id,
    )
    cwd = str(Path.home() / "graft-exports" / str(node.conversation_id))
    Path(cwd).mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    parent_uuid: str | None = None
    preamble_pending = bool(preamble)
    for r in chat_rows:
        msg_uuid = str(uuid.uuid4())
        ts = _now_iso()
        if r["role"] == "user":
            content = r["content"]
            if preamble_pending:
                content = preamble + content
                preamble_pending = False
            entry = {
                "parentUuid": parent_uuid,
                "isSidechain": False,
                "userType": "external",
                "cwd": cwd,
                "sessionId": session_id,
                "version": CC_VERSION,
                "type": "user",
                "message": {"role": "user", "content": content},
                "uuid": msg_uuid,
                "timestamp": ts,
            }
        else:
            entry = {
                "parentUuid": parent_uuid,
                "isSidechain": False,
                "userType": "external",
                "cwd": cwd,
                "sessionId": session_id,
                "version": CC_VERSION,
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "model": DEFAULT_MODEL,
                    "content": [{"type": "text", "text": r["content"]}],
                },
                "uuid": msg_uuid,
                "timestamp": ts,
            }
        lines.append(json.dumps(entry))
        parent_uuid = msg_uuid

    sessions_dir = Path.home() / ".claude" / "projects" / _encode_cwd(cwd)
    sessions_dir.mkdir(parents=True, exist_ok=True)
    file_path = sessions_dir / f"{session_id}.jsonl"
    file_path.write_text("\n".join(lines) + "\n")

    # Record the export so the next click can read this session's JSONL and
    # append any new CC turns to the branch.
    db.add(ClaudeExport(
        session_id=uuid.UUID(session_id),
        conversation_id=node.conversation_id,
        branch_id=node.branch_id,
        source_node_id=node.id,
        file_path=str(file_path),
        cwd=cwd,
        exported_message_count=len(chat_rows),
    ))
    db.commit()

    command = f'cd "{cwd}" && claude --resume {session_id}'

    launched = False
    launch_error: str | None = None
    if launch and platform.system() == "Darwin":
        # AppleScript string literals use `\"` to embed double quotes; the
        # `cd "..."` quoting in `command` would otherwise terminate the
        # do-script string early and produce a -2741 syntax error.
        escaped = command.replace("\\", "\\\\").replace('"', '\\"')
        applescript = (
            f'tell application "Terminal"\n'
            f'    activate\n'
            f'    do script "{escaped}"\n'
            f'end tell'
        )
        try:
            result = subprocess.run(
                ["osascript", "-e", applescript],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                launched = True
            else:
                launch_error = (result.stderr or result.stdout or "").strip()
        except Exception as exc:
            launch_error = f"{type(exc).__name__}: {exc}"

    return {
        "session_id": session_id,
        "file_path": str(file_path),
        "cwd": cwd,
        "command": command,
        "launched": launched,
        "launch_error": launch_error,
        "message_count": len(chat_rows),
        "synced_from_claude": synced_count,
    }
