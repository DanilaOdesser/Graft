"""Pytest fixtures shared by all DEV-A tests.

Tests run against the live Supabase DB with seed data already loaded.
We don't roll back — assertions key off seed UUIDs and unique titles
created per-test (timestamp-suffixed).
"""
import os
import sys
import time
import uuid

import pytest
from fastapi.testclient import TestClient

# Make `backend/` the import root so `from main import app` works.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app  # noqa: E402

# Deterministic seed UUIDs (uuid5 of NAMESPACE + short id).
ALEX_USER_ID = "2f75cca7-7ebc-5af0-a919-f0bfe59e4125"
RECIPEBOX_CONV_ID = "9f0ad37b-f4b9-56b4-9abd-bd51d830e396"
BR_MAIN_ID = "ae642808-6b30-58c5-833f-8e50045b5b63"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def unique_title():
    """Returns a title prefix unique to this test run."""
    return f"DEV-A test {int(time.time() * 1000)} {uuid.uuid4().hex[:6]}"
