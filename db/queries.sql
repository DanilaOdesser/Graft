-- =============================================================================
-- Three core queries for the Agent Context DB
-- =============================================================================

-- -----------------------------------------------------------------------------
-- QUERY 1: Context assembly at a node, under a token budget.
-- -----------------------------------------------------------------------------
-- Business purpose: "Build the AI's memory for a single conversation turn —
-- what should the AI remember?" Assembles the context window from ancestry,
-- pinned nodes, and imports, then truncates to fit the token budget.
--
-- This is the hot-path query — runs on every agent turn.
-- Given a node N (the user's current position) and a token budget B, return
-- the ordered set of nodes that should be assembled into the LLM context:
--   (a) ancestors of N on its branch path,
--   (b) nodes pinned to N's branch,
--   (c) nodes imported into N's branch from elsewhere (and optionally their
--       descendants if include_descendants was true at import time),
--   (d) excluding any node that's been elided by a summary node also visible
--       on the branch (we keep the summary instead),
-- ranked by (priority, recency) and truncated to fit the budget.
--
-- :current_node_id and :budget are bound parameters.

WITH params AS (
  SELECT :current_node_id::uuid AS current_node_id,
         :budget::int           AS budget
),
current_branch AS (
  SELECT n.branch_id
  FROM nodes n, params p
  WHERE n.id = p.current_node_id
),

-- (a) ancestors of the current node, via the closure table
ancestor_nodes AS (
  SELECT n.id, n.content, n.token_count, n.created_at,
         na.depth,
         0::smallint AS pin_priority,
         'ancestor'  AS source
  FROM node_ancestry na
  JOIN nodes n ON n.id = na.ancestor_id
  JOIN params p ON na.descendant_id = p.current_node_id
),

-- (b) nodes explicitly pinned to the current branch
pinned_nodes AS (
  SELECT n.id, n.content, n.token_count, n.created_at,
         NULL::int AS depth,
         cp.priority AS pin_priority,
         'pinned' AS source
  FROM context_pins cp
  JOIN current_branch cb ON cp.branch_id = cb.branch_id
  JOIN nodes n ON n.id = cp.node_id
),

-- (c) nodes imported into the current branch from other branches.
-- If include_descendants is true, expand via the closure table.
imported_nodes AS (
  SELECT DISTINCT n.id, n.content, n.token_count, n.created_at,
         NULL::int AS depth,
         0::smallint AS pin_priority,
         'imported' AS source
  FROM context_imports ci
  JOIN current_branch cb ON ci.target_branch_id = cb.branch_id
  JOIN node_ancestry na
    ON na.ancestor_id = ci.source_node_id
   AND (ci.include_descendants OR na.descendant_id = ci.source_node_id)
  JOIN nodes n ON n.id = na.descendant_id
),

-- Union of all candidate nodes (a) ∪ (b) ∪ (c)
candidates AS (
  SELECT * FROM ancestor_nodes
  UNION
  SELECT * FROM pinned_nodes
  UNION
  SELECT * FROM imported_nodes
),

-- (d) Find nodes that are summarized BY some other candidate node, so we can
-- elide them in favor of their summary.
elided AS (
  SELECT ns.summarized_node_id AS node_id
  FROM node_summaries ns
  WHERE ns.summary_node_id IN (SELECT id FROM candidates)
),

-- Rank by: pinned first (high priority), then ancestors (closest first),
-- then imported, then by recency.
ranked AS (
  SELECT c.*,
         ROW_NUMBER() OVER (
           ORDER BY c.pin_priority DESC,
                    CASE c.source
                      WHEN 'pinned'   THEN 0
                      WHEN 'ancestor' THEN 1
                      WHEN 'imported' THEN 2
                    END,
                    COALESCE(c.depth, 999),  -- closer ancestors first
                    c.created_at DESC
         ) AS rank
  FROM candidates c
  WHERE c.id NOT IN (SELECT node_id FROM elided)
),

-- Cumulative token sum; cut off when we exceed budget.
budgeted AS (
  SELECT *,
         SUM(token_count) OVER (ORDER BY rank) AS running_tokens
  FROM ranked
)

SELECT id, source, pin_priority, depth, token_count, running_tokens, content
FROM budgeted, params
WHERE running_tokens <= params.budget
ORDER BY rank;


-- -----------------------------------------------------------------------------
-- QUERY 2: Branch divergence report.
-- -----------------------------------------------------------------------------
-- Business purpose: "Compare two conversation branches — what did each explore
-- that the other didn't?" Helps users decide whether to merge branches.
--
-- Compare two branches A and B. Return:
--   - their lowest common ancestor,
--   - count of nodes only on A's path,
--   - count of nodes only on B's path,
--   - the actual node ids on each side, for display.
--
-- Useful for "should I merge these branches?"
--
-- :branch_a, :branch_b are parameters.

WITH a_head AS (SELECT head_node_id FROM branches WHERE id = :branch_a),
     b_head AS (SELECT head_node_id FROM branches WHERE id = :branch_b),

-- Ancestor sets of each branch's head
a_ancestors AS (
  SELECT na.ancestor_id, na.depth
  FROM node_ancestry na, a_head
  WHERE na.descendant_id = a_head.head_node_id
),
b_ancestors AS (
  SELECT na.ancestor_id, na.depth
  FROM node_ancestry na, b_head
  WHERE na.descendant_id = b_head.head_node_id
),

-- LCA = the common ancestor with the smallest max-depth across both sides.
common AS (
  SELECT a.ancestor_id, GREATEST(a.depth, b.depth) AS max_depth
  FROM a_ancestors a
  JOIN b_ancestors b ON a.ancestor_id = b.ancestor_id
),
lca AS (
  SELECT ancestor_id AS lca_node_id
  FROM common
  ORDER BY max_depth ASC
  LIMIT 1
),

-- Nodes on each side that the other side doesn't have
only_a AS (
  SELECT ancestor_id AS node_id FROM a_ancestors
  EXCEPT
  SELECT ancestor_id FROM b_ancestors
),
only_b AS (
  SELECT ancestor_id AS node_id FROM b_ancestors
  EXCEPT
  SELECT ancestor_id FROM a_ancestors
)

SELECT
  (SELECT lca_node_id FROM lca)                          AS lca_node_id,
  (SELECT COUNT(*) FROM only_a)                          AS only_a_count,
  (SELECT COUNT(*) FROM only_b)                          AS only_b_count,
  (SELECT json_agg(node_id) FROM only_a)                 AS only_a_nodes,
  (SELECT json_agg(node_id) FROM only_b)                 AS only_b_nodes;


-- -----------------------------------------------------------------------------
-- QUERY 3: Full-text search across the user's conversations,
--          with branch context.
-- -----------------------------------------------------------------------------
-- Business purpose: "Search all conversations for relevant context to
-- cherry-pick into the current branch." Enables cross-conversation reuse.
--
-- User types a natural-language query; Postgres FTS ranks the K most relevant
-- nodes across all of the user's conversations, returning each match with its
-- branch and conversation context so it can be shown for cherry-picking.
--
-- websearch_to_tsquery accepts Google-style syntax ("foo OR bar", -exclude,
-- "exact phrase"). The GIN index on nodes.content_tsv handles the @@ match.
--
-- :query_text, :user_id, :k are parameters.

SELECT
  n.id              AS node_id,
  n.content,
  n.role,
  n.created_at,
  b.id              AS branch_id,
  b.name            AS branch_name,
  c.id              AS conversation_id,
  c.title           AS conversation_title,
  ts_rank(n.content_tsv, websearch_to_tsquery('english', :query_text)) AS rank
FROM nodes n
JOIN branches b      ON b.id = n.branch_id
JOIN conversations c ON c.id = n.conversation_id
WHERE c.owner_id = :user_id
  AND b.is_archived = false
  AND n.content_tsv @@ websearch_to_tsquery('english', :query_text)
ORDER BY rank DESC, n.created_at DESC
LIMIT :k;
