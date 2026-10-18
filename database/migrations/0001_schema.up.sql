-- E41 business schema. Run only via 0001_apply.sql, as a privileged migrator.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compunube_migrator') THEN
    CREATE ROLE compunube_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compunube_match_app') THEN
    CREATE ROLE compunube_match_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compunube_player_app') THEN
    CREATE ROLE compunube_player_app NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS match;
CREATE SCHEMA IF NOT EXISTS player;
ALTER SCHEMA match OWNER TO compunube_migrator;
ALTER SCHEMA player OWNER TO compunube_migrator;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO compunube_match_app, compunube_player_app', current_database());
END $$;
REVOKE ALL ON SCHEMA match, player FROM PUBLIC;
GRANT USAGE ON SCHEMA match TO compunube_match_app;
GRANT USAGE ON SCHEMA player TO compunube_player_app;

SET ROLE compunube_migrator;

CREATE TABLE player.profiles (
  player_id TEXT PRIMARY KEY,
  coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  plastic BIGINT NOT NULL DEFAULT 0 CHECK (plastic >= 0),
  metal BIGINT NOT NULL DEFAULT 0 CHECK (metal >= 0),
  profile_revision BIGINT NOT NULL DEFAULT 0 CHECK (profile_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE player.catalog_versions (
  catalog_version TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX catalog_one_active ON player.catalog_versions (active) WHERE active;

CREATE TABLE player.item_definitions (
  item_id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('character','board','outfit','net','hair')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE player.catalog_entries (
  catalog_version TEXT NOT NULL REFERENCES player.catalog_versions(catalog_version),
  item_id TEXT NOT NULL REFERENCES player.item_definitions(item_id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_coins BIGINT CHECK (price_coins >= 0),
  recipe_plastic BIGINT NOT NULL DEFAULT 0 CHECK (recipe_plastic >= 0),
  recipe_metal BIGINT NOT NULL DEFAULT 0 CHECK (recipe_metal >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (catalog_version, item_id)
);

CREATE TABLE player.owned_items (
  player_id TEXT NOT NULL REFERENCES player.profiles(player_id),
  item_id TEXT NOT NULL REFERENCES player.item_definitions(item_id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquisition_type TEXT NOT NULL,
  PRIMARY KEY (player_id, item_id)
);
CREATE INDEX owned_items_by_item ON player.owned_items (item_id, player_id);

CREATE TABLE player.equipment_slots (
  player_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('board','outfit','net','hair','character')),
  item_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slot),
  FOREIGN KEY (player_id, item_id) REFERENCES player.owned_items(player_id, item_id)
);

CREATE TABLE player.profile_appearance (
  player_id TEXT PRIMARY KEY REFERENCES player.profiles(player_id),
  skin_id TEXT NOT NULL,
  hair_color_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE player.economic_operations (
  player_id TEXT NOT NULL REFERENCES player.profiles(player_id),
  request_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('buy','craft','exchange','equip','appearance')),
  request_fingerprint TEXT NOT NULL,
  catalog_version TEXT REFERENCES player.catalog_versions(catalog_version),
  status TEXT NOT NULL CHECK (status IN ('applied','rejected')),
  profile_revision_after BIGINT CHECK (profile_revision_after >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, request_id)
);
CREATE INDEX economic_operations_by_player ON player.economic_operations (player_id, created_at DESC);
CREATE INDEX economic_operations_by_status ON player.economic_operations (status, created_at);

CREATE TABLE player.settlements (
  race_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES player.profiles(player_id),
  result_fingerprint TEXT NOT NULL,
  credited_plastic BIGINT NOT NULL CHECK (credited_plastic >= 0),
  credited_metal BIGINT NOT NULL CHECK (credited_metal >= 0),
  profile_revision_after BIGINT NOT NULL CHECK (profile_revision_after >= 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, player_id)
);
CREATE INDEX settlements_by_player ON player.settlements (player_id, applied_at DESC);

CREATE TABLE match.rooms (
  room_id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE match.races (
  race_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES match.rooms(room_id),
  rules_version TEXT NOT NULL,
  course_version TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  first_finished_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
CREATE INDEX races_by_room ON match.races (room_id, started_at DESC);
CREATE INDEX races_by_end ON match.races (ended_at DESC);

CREATE TABLE match.race_participants (
  race_id TEXT NOT NULL REFERENCES match.races(race_id),
  player_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('finished','disqualified','left','dnf')),
  rank INTEGER CHECK (rank > 0),
  finish_time_ms BIGINT CHECK (finish_time_ms >= 0),
  collected_plastic BIGINT NOT NULL DEFAULT 0 CHECK (collected_plastic >= 0),
  collected_metal BIGINT NOT NULL DEFAULT 0 CHECK (collected_metal >= 0),
  credited_plastic BIGINT NOT NULL DEFAULT 0 CHECK (credited_plastic >= 0 AND credited_plastic <= collected_plastic),
  credited_metal BIGINT NOT NULL DEFAULT 0 CHECK (credited_metal >= 0 AND credited_metal <= collected_metal),
  reduce_choice TEXT NOT NULL CHECK (reduce_choice IN ('reusable','disposable')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, player_id),
  CHECK ((outcome = 'finished') = (rank IS NOT NULL)),
  CHECK ((outcome = 'finished') = (finish_time_ms IS NOT NULL)),
  CHECK (outcome = 'finished' OR (credited_plastic = 0 AND credited_metal = 0))
);
CREATE UNIQUE INDEX race_rank_unique ON match.race_participants (race_id, rank) WHERE rank IS NOT NULL;
CREATE INDEX race_participants_by_player ON match.race_participants (player_id, recorded_at DESC);

CREATE TABLE match.settlement_delivery (
  race_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','confirmed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  next_attempt_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, player_id),
  FOREIGN KEY (race_id, player_id) REFERENCES match.race_participants(race_id, player_id)
);
CREATE INDEX settlement_delivery_pending ON match.settlement_delivery (state, next_attempt_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA match TO compunube_match_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA player TO compunube_player_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA match GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO compunube_match_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA player GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO compunube_player_app;
RESET ROLE;
