"""In-process SSE pub/sub.

publish() is async — call it with `await` from async route handlers.
Each subscriber gets its own asyncio.Queue. The event_generator
yields SSE-formatted strings and sends a heartbeat comment every 30s
to keep the connection alive through proxies.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

_channels: dict[str, list[asyncio.Queue]] = {}


async def subscribe(conv_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _channels.setdefault(conv_id, []).append(q)
    return q


def unsubscribe(conv_id: str, q: asyncio.Queue) -> None:
    ch = _channels.get(conv_id, [])
    if q in ch:
        ch.remove(q)


async def publish(conv_id: str, event_type: str, payload: dict) -> None:
    msg = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
    for q in list(_channels.get(conv_id, [])):
        await q.put(msg)


async def event_generator(conv_id: str, q: asyncio.Queue) -> AsyncIterator[str]:
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=30.0)
                yield msg
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        unsubscribe(conv_id, q)
