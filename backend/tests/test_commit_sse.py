import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sse import subscribe, publish, unsubscribe

@pytest.mark.asyncio
async def test_publish_delivers_to_subscriber():
    q = await subscribe("conv-abc")
    await publish("conv-abc", "node_created", {"node": {"id": "x"}})
    msg = q.get_nowait()
    assert "node_created" in msg
    assert '"id": "x"' in msg
    unsubscribe("conv-abc", q)

@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery():
    q = await subscribe("conv-xyz")
    unsubscribe("conv-xyz", q)
    await publish("conv-xyz", "test_event", {})
    assert q.empty()

from llm import summarize_nodes

def test_summarize_nodes_stub_when_no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    nodes = [
        {"role": "user", "content": "How do I reverse a list in Python?"},
        {"role": "assistant", "content": "Use list[::-1] or list.reverse()."},
    ]
    result = summarize_nodes(nodes)
    assert isinstance(result, str)
    assert len(result) > 0

def test_summarize_nodes_empty():
    result = summarize_nodes([])
    assert isinstance(result, str)
