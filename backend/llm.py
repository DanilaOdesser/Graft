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
    messages: list[dict] = [
        {"role": n["role"], "content": n["content"]}
        for n in context_nodes
        if n.get("role") in ("user", "assistant")
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
