"""LLM dispatch — Anthropic when key is set, stub otherwise."""
from __future__ import annotations

import os
from typing import Iterable


STUB_PREFIX = "[Stub]"


def _stub_reply(context_count: int, total_tokens: int) -> str:
    return (
        f"{STUB_PREFIX} I received your message with {context_count} context nodes "
        f"totaling {total_tokens} tokens. (Set ANTHROPIC_API_KEY for a real reply.)"
    )


def call_llm(context_nodes: list[dict]) -> str:
    """Format context as a Claude messages list and call the API.

    `context_nodes` are rows from Query 1 (id, source, content, ..., role) but
    Query 1 doesn't return role — we look at `source` only when no role is set.
    Caller must ensure messages are ordered chronologically before passing.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    total_tokens = sum(n.get("token_count", 0) for n in context_nodes)
    if not api_key:
        return _stub_reply(len(context_nodes), total_tokens)

    # Real Anthropic call — only imported when the key exists, so tests
    # without a key don't need the package configured.
    from anthropic import Anthropic

    # Pin the base URL so a shell-exported ANTHROPIC_BASE_URL (e.g. a corp
    # LiteLLM proxy) doesn't redirect the request and reject our key.
    client = Anthropic(api_key=api_key, base_url="https://api.anthropic.com")
    system_chunks = [n["content"] for n in context_nodes if n.get("role") == "system"]

    # Query 1 ranks ancestors newest-first (depth ASC). Re-sort so the LLM
    # receives them in chronological order: ancestors oldest-first (depth DESC),
    # then non-ancestors (pinned/imported) at the end.
    def _sort_key(n: dict) -> tuple:
        if n.get("source") == "ancestor":
            depth = n.get("depth") or 0
            return (0, -depth)   # negative so higher depth (older) sorts first
        return (1, 0)

    chat_nodes = sorted(
        [n for n in context_nodes if n.get("role") in ("user", "assistant")],
        key=_sort_key,
    )
    messages: list[dict] = [
        {"role": n["role"], "content": n["content"]}
        for n in chat_nodes
    ]
    if not messages:
        # Anthropic requires at least one user message; surface a stub instead
        # of erroring. (The agent-turn endpoint inserts a user node before
        # calling, so this branch should be unreachable in practice.)
        return _stub_reply(len(context_nodes), total_tokens)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1024,
            system="\n\n".join(system_chunks) or "You are a helpful AI assistant.",
            messages=messages,
        )
        return response.content[0].text
    except Exception as exc:
        # Auth, rate-limit, network, etc. — keep the agent-turn endpoint working
        # with a stub instead of bubbling 500 to the frontend.
        import sys
        print(f"[llm.call_llm] falling back to stub: {type(exc).__name__}: {exc}",
              file=sys.stderr)
        return _stub_reply(len(context_nodes), total_tokens)


def summarize_nodes(nodes: list[dict]) -> str:
    """Generate a 1-2 sentence summary of a list of conversation nodes.

    Used by the commit endpoint. Falls back to a stub if ANTHROPIC_API_KEY
    is not set or if the API call fails.
    """
    if not nodes:
        return "Empty commit — no messages to summarize."

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        preview = " | ".join(
            (n.get("content") or "")[:60] for n in nodes[:3]
        )
        return f"[Stub] Recent turns: {preview[:200]}"

    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    combined = "\n\n".join(
        f"[{n.get('role', 'unknown')}]: {n.get('content', '')}"
        for n in nodes
    )
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system=(
                "Summarize the following conversation turns in 1-2 sentences. "
                "Be concise and factual. Do not start with 'The conversation'."
            ),
            messages=[{"role": "user", "content": combined}],
        )
        return response.content[0].text
    except Exception as exc:
        import sys as _sys
        print(f"[llm.summarize_nodes] fallback: {type(exc).__name__}: {exc}",
              file=_sys.stderr)
        return f"[Summary unavailable: {type(exc).__name__}]"
