#!/usr/bin/env python3
"""
Load db/seed/data.json into Postgres via psql.

The JSON uses short IDs (u-alex, br-main, n-07, ...). We map each one
deterministically to a UUID via uuid5 with a fixed namespace, so re-running
produces the same UUIDs and seed-derived references work across dev machines.

Usage:
    python scripts/load_seed.py

Reads DATABASE_URL from .env (or the environment). Pipes generated SQL into
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1` — same psql you already use.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

NAMESPACE = uuid.UUID("12345678-1234-1234-1234-123456789abc")
REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = REPO_ROOT / "db" / "seed" / "data.json"
ENV_PATH = REPO_ROOT / ".env"


def load_dotenv() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def to_uuid(short_id: str | None) -> str | None:
    if short_id is None:
        return None
    try:
        return str(uuid.UUID(short_id))
    except ValueError:
        return str(uuid.uuid5(NAMESPACE, short_id))


def sql_lit(value) -> str:
    """Render a Python value as a SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value).replace("'", "''")
    return f"'{s}'"


def insert(table: str, cols: list[str], rows: list[list]) -> str:
    if not rows:
        return ""
    col_list = ", ".join(cols)
    values = ",\n  ".join(
        "(" + ", ".join(sql_lit(v) for v in row) + ")" for row in rows
    )
    return f"INSERT INTO {table} ({col_list}) VALUES\n  {values};\n"


def build_sql(data: dict) -> str:
    out: list[str] = []
    out.append("BEGIN;\n")

    # 1. users
    out.append(insert("users",
        ["id", "email", "display_name", "created_at"],
        [[to_uuid(u["id"]), u["email"], u["display_name"], u["created_at"]]
         for u in data["users"]],
    ))

    # 2. tags
    out.append(insert("tags",
        ["id", "name"],
        [[to_uuid(t["id"]), t["name"]] for t in data["tags"]],
    ))

    # 3. conversations — root_node_id and default_branch_id NULL for now.
    out.append(insert("conversations",
        ["id", "owner_id", "title", "root_node_id", "default_branch_id",
         "created_at", "updated_at"],
        [[to_uuid(c["id"]), to_uuid(c["owner_id"]), c["title"], None, None,
          c["created_at"], c["updated_at"]] for c in data["conversations"]],
    ))

    # 4. branches — head/base NULL for now (FKs to nodes that don't exist yet).
    out.append(insert("branches",
        ["id", "conversation_id", "name", "head_node_id", "base_node_id",
         "created_by", "is_archived", "created_at"],
        [[to_uuid(b["id"]), to_uuid(b["conversation_id"]), b["name"],
          None, None, to_uuid(b["created_by"]), b["is_archived"],
          b["created_at"]] for b in data["branches"]],
    ))

    # 5. nodes — JSON order is parent-first, so the closure trigger works.
    out.append(insert("nodes",
        ["id", "conversation_id", "parent_id", "branch_id", "node_type",
         "role", "content", "token_count", "created_at"],
        [[to_uuid(n["id"]), to_uuid(n["conversation_id"]),
          to_uuid(n["parent_id"]), to_uuid(n["branch_id"]),
          n["node_type"], n["role"], n["content"], n["token_count"],
          n["created_at"]] for n in data["nodes"]],
    ))

    # 6. backfill branches.head_node_id / base_node_id
    for b in data["branches"]:
        out.append(
            f"UPDATE branches SET head_node_id = {sql_lit(to_uuid(b['head_node_id']))}, "
            f"base_node_id = {sql_lit(to_uuid(b['base_node_id']))} "
            f"WHERE id = {sql_lit(to_uuid(b['id']))};\n"
        )

    # 7. backfill conversations.root_node_id / default_branch_id
    for c in data["conversations"]:
        out.append(
            f"UPDATE conversations SET root_node_id = {sql_lit(to_uuid(c['root_node_id']))}, "
            f"default_branch_id = {sql_lit(to_uuid(c['default_branch_id']))} "
            f"WHERE id = {sql_lit(to_uuid(c['id']))};\n"
        )

    # 8. context_pins
    out.append(insert("context_pins",
        ["id", "branch_id", "node_id", "pinned_by", "reason", "priority",
         "created_at"],
        [[to_uuid(p["id"]), to_uuid(p["branch_id"]), to_uuid(p["node_id"]),
          to_uuid(p["pinned_by"]), p.get("reason"), p["priority"],
          p["created_at"]] for p in data["context_pins"]],
    ))

    # 9. context_imports
    out.append(insert("context_imports",
        ["id", "target_branch_id", "source_node_id", "include_descendants",
         "imported_by", "imported_at"],
        [[to_uuid(i["id"]), to_uuid(i["target_branch_id"]),
          to_uuid(i["source_node_id"]), i["include_descendants"],
          to_uuid(i["imported_by"]), i["imported_at"]]
         for i in data["context_imports"]],
    ))

    # 10. node_summaries
    out.append(insert("node_summaries",
        ["summary_node_id", "summarized_node_id"],
        [[to_uuid(s["summary_node_id"]), to_uuid(s["summarized_node_id"])]
         for s in data["node_summaries"]],
    ))

    # 11. node_tags
    out.append(insert("node_tags",
        ["node_id", "tag_id"],
        [[to_uuid(nt["node_id"]), to_uuid(nt["tag_id"])]
         for nt in data["node_tags"]],
    ))

    # 12. branch_shares
    out.append(insert("branch_shares",
        ["id", "branch_id", "shared_with", "permission", "created_at"],
        [[to_uuid(s["id"]), to_uuid(s["branch_id"]),
          to_uuid(s["shared_with"]) if s["shared_with"] else None,
          s["permission"], s["created_at"]] for s in data["branch_shares"]],
    ))

    out.append("COMMIT;\n")
    return "".join(out)


def main() -> int:
    load_dotenv()
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set (check .env)", file=sys.stderr)
        return 1

    data = json.loads(DATA_PATH.read_text())
    sql = build_sql(data)

    # Optional: dump to a file for inspection.
    if "--dry-run" in sys.argv:
        sys.stdout.write(sql)
        return 0

    try:
        result = subprocess.run(
            ["psql", db_url, "-v", "ON_ERROR_STOP=1"],
            input=sql,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        print("ERROR: psql not found on PATH. Install with `brew install libpq && brew link --force libpq`.",
              file=sys.stderr)
        return 1

    if result.returncode != 0:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        print("\nseed: FAILED", file=sys.stderr)
        return result.returncode

    # Summary line per table — count from data.
    counts = {
        "users": len(data["users"]),
        "tags": len(data["tags"]),
        "conversations": len(data["conversations"]),
        "branches": len(data["branches"]),
        "nodes": len(data["nodes"]),
        "context_pins": len(data["context_pins"]),
        "context_imports": len(data["context_imports"]),
        "node_summaries": len(data["node_summaries"]),
        "node_tags": len(data["node_tags"]),
        "branch_shares": len(data["branch_shares"]),
    }
    print("seed: ok")
    for table, n in counts.items():
        print(f"  {table:18s} {n:>4} rows")
    print(f"  node_ancestry      auto-populated by trigger")
    return 0


if __name__ == "__main__":
    sys.exit(main())
