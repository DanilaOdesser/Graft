"""
CLI tool to ingest plain-text transcripts into Graft.

Usage: python -m scripts.ingest <transcript.txt> [--user-id UUID] [--api-url URL]

Input format:
    User: How do I set up a Postgres database?
    Assistant: First, install PostgreSQL...
"""
import argparse
import re
import sys
import uuid
import requests

DEFAULT_API = "http://localhost:8000/api"


def parse_transcript(filepath: str) -> list[tuple[str, str]]:
    with open(filepath, "r") as f:
        text = f.read()
    pattern = r"^(User|Assistant|System):\s*"
    parts = re.split(pattern, text, flags=re.MULTILINE)
    messages = []
    i = 1
    while i < len(parts) - 1:
        role = parts[i].lower()
        content = parts[i + 1].strip()
        if content:
            messages.append((role, content))
        i += 2
    return messages


def main():
    parser = argparse.ArgumentParser(description="Ingest a transcript into Graft")
    parser.add_argument("transcript", help="Path to transcript file")
    parser.add_argument("--user-id", required=True, help="UUID of the user")
    parser.add_argument("--api-url", default=DEFAULT_API, help="API base URL")
    args = parser.parse_args()

    api = args.api_url

    messages = parse_transcript(args.transcript)
    if not messages:
        print("Error: No messages found in transcript")
        sys.exit(1)

    title = args.transcript.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("_", " ").title()

    # Create conversation (DEV-A endpoint — creates root node + main branch)
    resp = requests.post(f"{api}/conversations", json={"owner_id": args.user_id, "title": title})
    resp.raise_for_status()
    conv = resp.json()
    conv_id = conv["id"]
    branch_id = conv["default_branch_id"]
    root_node_id = conv["root_node_id"]

    parent_id = root_node_id
    node_count = 0
    for role, content in messages:
        resp = requests.post(f"{api}/nodes", json={
            "conversation_id": conv_id,
            "parent_id": parent_id,
            "branch_id": branch_id,
            "node_type": "message",
            "role": role,
            "content": content,
        })
        resp.raise_for_status()
        node = resp.json()
        parent_id = node["id"]
        node_count += 1

    print(f'Created conversation "{title}" ({conv_id}) with {node_count} nodes on branch main')


if __name__ == "__main__":
    main()
