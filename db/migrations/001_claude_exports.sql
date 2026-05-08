-- Track Claude Code export sessions so a subsequent → Claude click can pull
-- in any new turns the user added in CC and append them to the source branch
-- before launching a fresh session.
--
-- Run on existing DBs:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_claude_exports.sql

BEGIN;

CREATE TABLE IF NOT EXISTS claude_exports (
    session_id              UUID         PRIMARY KEY,
    conversation_id         UUID         NOT NULL REFERENCES conversations(id),
    branch_id               UUID         NOT NULL REFERENCES branches(id),
    source_node_id          UUID         NOT NULL REFERENCES nodes(id),
    file_path               TEXT         NOT NULL,
    cwd                     TEXT         NOT NULL,
    exported_message_count  INT          NOT NULL,
    last_imported_uuid      TEXT,
    exported_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_imported_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_claude_exports_branch ON claude_exports(branch_id, exported_at DESC);

COMMIT;
