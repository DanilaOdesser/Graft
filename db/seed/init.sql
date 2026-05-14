-- =============================================================================
-- Graft — Initial schema
-- =============================================================================
-- Run once against an empty database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init.sql
--
-- To re-run on an already-populated DB, drop the public schema first:
--   psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
-- =============================================================================

BEGIN;

-- ---------- users ----------------------------------------------------------

CREATE TABLE users (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    password_hash   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- conversations --------------------------------------------------
-- root_node_id and default_branch_id are nullable + backfilled later because
-- nodes/branches don't exist yet at conversation-creation time.

CREATE TABLE conversations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID         NOT NULL REFERENCES users(id),
    title               VARCHAR(200) NOT NULL,
    root_node_id        UUID,
    default_branch_id   UUID,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_owner        ON conversations(owner_id);
CREATE INDEX idx_conv_owner_recent ON conversations(owner_id, updated_at DESC);

-- ---------- nodes ----------------------------------------------------------
-- branch_id has no FK yet; added via ALTER once branches table exists.
-- content_tsv is a generated column — Postgres recomputes it on every
-- INSERT/UPDATE of `content`. No application trigger needed.

CREATE TABLE nodes (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID         NOT NULL REFERENCES conversations(id),
    parent_id       UUID         REFERENCES nodes(id),
    branch_id       UUID         NOT NULL,
    node_type       VARCHAR(20)  NOT NULL
                    CHECK (node_type IN ('message', 'commit', 'merge', 'summary')),
    role            VARCHAR(20)
                    CHECK (role IN ('user', 'assistant', 'system') OR role IS NULL),
    content         TEXT         NOT NULL,
    token_count     INT          NOT NULL DEFAULT 0,
    content_tsv     TSVECTOR     GENERATED ALWAYS AS (
                        to_tsvector('english', content)
                    ) STORED,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_nodes_conv          ON nodes(conversation_id);
CREATE INDEX idx_nodes_parent        ON nodes(parent_id);
CREATE INDEX idx_nodes_branch        ON nodes(branch_id);
CREATE INDEX idx_nodes_conv_recent   ON nodes(conversation_id, created_at DESC);
CREATE INDEX idx_nodes_content_tsv   ON nodes USING gin(content_tsv);

-- ---------- node_ancestry (closure table) ----------------------------------
-- Pre-computed (ancestor, descendant, depth) triples maintained by the
-- AFTER INSERT trigger below. Application code never writes this table.

CREATE TABLE node_ancestry (
    ancestor_id     UUID NOT NULL REFERENCES nodes(id),
    descendant_id   UUID NOT NULL REFERENCES nodes(id),
    depth           INT  NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX idx_ancestry_desc_depth ON node_ancestry(descendant_id, depth);

CREATE OR REPLACE FUNCTION maintain_node_ancestry()
RETURNS TRIGGER AS $$
BEGIN
    -- self row at depth 0
    INSERT INTO node_ancestry (ancestor_id, descendant_id, depth)
    VALUES (NEW.id, NEW.id, 0);

    -- copy parent's ancestor rows, incrementing depth
    IF NEW.parent_id IS NOT NULL THEN
        INSERT INTO node_ancestry (ancestor_id, descendant_id, depth)
        SELECT na.ancestor_id, NEW.id, na.depth + 1
        FROM node_ancestry na
        WHERE na.descendant_id = NEW.parent_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_node_ancestry
    AFTER INSERT ON nodes
    FOR EACH ROW
    EXECUTE FUNCTION maintain_node_ancestry();

-- ---------- branches -------------------------------------------------------

CREATE TABLE branches (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID         NOT NULL REFERENCES conversations(id),
    name            VARCHAR(100) NOT NULL,
    head_node_id    UUID         REFERENCES nodes(id),
    base_node_id    UUID         REFERENCES nodes(id),
    created_by      UUID         NOT NULL REFERENCES users(id),
    is_archived     BOOLEAN      NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Deferred FKs:
ALTER TABLE nodes
    ADD CONSTRAINT fk_nodes_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id);

ALTER TABLE conversations
    ADD CONSTRAINT fk_conv_root_node
    FOREIGN KEY (root_node_id) REFERENCES nodes(id);

ALTER TABLE conversations
    ADD CONSTRAINT fk_conv_default_branch
    FOREIGN KEY (default_branch_id) REFERENCES branches(id);

CREATE UNIQUE INDEX uniq_branch_name_per_conv ON branches(conversation_id, name);
CREATE INDEX idx_branch_head   ON branches(head_node_id);
CREATE INDEX idx_branch_base   ON branches(base_node_id);
CREATE INDEX idx_branch_active ON branches(conversation_id) WHERE is_archived = false;

-- ---------- context_pins ---------------------------------------------------

CREATE TABLE context_pins (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id   UUID        NOT NULL REFERENCES branches(id),
    node_id     UUID        NOT NULL REFERENCES nodes(id),
    pinned_by   UUID        NOT NULL REFERENCES users(id),
    reason      TEXT,
    priority    SMALLINT    NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (branch_id, node_id)
);

CREATE INDEX idx_pins_branch_priority ON context_pins(branch_id, priority DESC);

-- ---------- context_imports ------------------------------------------------

CREATE TABLE context_imports (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_branch_id    UUID        NOT NULL REFERENCES branches(id),
    source_node_id      UUID        NOT NULL REFERENCES nodes(id),
    include_descendants BOOLEAN     NOT NULL DEFAULT false,
    imported_by         UUID        NOT NULL REFERENCES users(id),
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_imports_target_recent ON context_imports(target_branch_id, imported_at DESC);
CREATE INDEX idx_imports_source        ON context_imports(source_node_id);

-- ---------- node_summaries -------------------------------------------------

CREATE TABLE node_summaries (
    summary_node_id    UUID NOT NULL REFERENCES nodes(id),
    summarized_node_id UUID NOT NULL REFERENCES nodes(id),
    PRIMARY KEY (summary_node_id, summarized_node_id)
);

CREATE INDEX idx_summaries_original ON node_summaries(summarized_node_id);

-- ---------- tags & social layer --------------------------------------------

CREATE TABLE tags (
    id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE node_tags (
    node_id UUID NOT NULL REFERENCES nodes(id),
    tag_id  UUID NOT NULL REFERENCES tags(id),
    PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX idx_node_tags_tag ON node_tags(tag_id);

-- ---------- claude_exports ------------------------------------------------
-- Bookkeeping for Claude Code round-trip sessions. Written by the export
-- endpoint; read on the next export click so any new CC turns get appended
-- to the source branch before re-exporting.

CREATE TABLE claude_exports (
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

CREATE INDEX idx_claude_exports_branch ON claude_exports(branch_id, exported_at DESC);

COMMIT;
