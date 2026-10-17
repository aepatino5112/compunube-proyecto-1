CREATE SCHEMA IF NOT EXISTS match;
CREATE SCHEMA IF NOT EXISTS player;

COMMENT ON SCHEMA match IS 'Data owned by the Go Match Service.';
COMMENT ON SCHEMA player IS 'Persistent data owned by the Rust Player/Profile Service.';
