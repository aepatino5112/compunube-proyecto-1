-- F48 / ADR 0005: Go sessions survive a Go restart. Run only via
-- 0003_apply.sql, as a privileged migrator, after 0001 and 0002. Idempotent.
--
-- Only the SHA-256 hash of the session token is stored; the token itself never
-- leaves the client and the Go process. player_id is the opaque identity Go
-- issued; Rust keys the profile by it, so restoring the session restores access
-- to that player's online profile. No foreign keys across schemas.
SET ROLE compunube_migrator;

CREATE TABLE IF NOT EXISTS match.sessions (
  token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  player_id TEXT NOT NULL UNIQUE CHECK (player_id <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default privileges from 0001 already grant DML on new match tables to
-- compunube_match_app; repeat it explicitly so the grant does not depend on them.
GRANT SELECT, INSERT, UPDATE, DELETE ON match.sessions TO compunube_match_app;
RESET ROLE;
