-- Migration 002: drop branch_shares table
-- branch_shares was never wired to any router or application logic.
BEGIN;
DROP TABLE IF EXISTS branch_shares;
COMMIT;
