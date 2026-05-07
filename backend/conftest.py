"""Backend-level pytest configuration.

DEV-B's tests/test_phase1.py and tests/test_phase2.py are standalone scripts
(they call sys.exit at module level) — collecting them via pytest fails with
INTERNALERROR. Skip them so DEV-A's pytest suite runs cleanly. They can still
be invoked directly via `python tests/test_phase1.py`.
"""
collect_ignore_glob = [
    "tests/test_phase1.py",
    "tests/test_phase2.py",
]
