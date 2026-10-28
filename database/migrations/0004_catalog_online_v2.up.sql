-- Economy rebalance: catalog `online-v2`. Run only via 0004_apply.sql, as a
-- privileged migrator, after 0002. Every statement is idempotent so a manual
-- re-run is harmless; 0004_apply.sql additionally records version 0004.
--
-- surf-mvp-3 doubled the course (1800 m) and roughly the materials a finisher
-- collects, so one race bought the whole shop and most of the workshop. Shop
-- prices and workshop recipes are five times those of `online-v1`; items,
-- names, descriptions and metadata are unchanged, and exchange rates stay
-- constants of the Rust domain (4 coins per plastic, 6 per metal).
--
-- `online-v1` is kept as history but unpublished: operations recorded against
-- it still replay, and new ones are refused with INVALID_CATALOG_VERSION, so
-- nobody can keep buying at its prices by naming it. Values mirror
-- apps/web/dist/economy.js.
SET ROLE compunube_migrator;

INSERT INTO player.catalog_versions (catalog_version, active, published_at)
VALUES ('online-v2', false, NULL)
ON CONFLICT (catalog_version) DO NOTHING;

INSERT INTO player.catalog_entries
  (catalog_version, item_id, name, description, price_coins, recipe_plastic, recipe_metal, metadata, enabled)
SELECT 'online-v2', item_id, name, description,
       price_coins * 5, recipe_plastic * 5, recipe_metal * 5, metadata, enabled
FROM player.catalog_entries
WHERE catalog_version = 'online-v1'
ON CONFLICT (catalog_version, item_id) DO NOTHING;

-- One active version at a time (unique index): retire v1 before publishing v2.
UPDATE player.catalog_versions SET active = false, published_at = NULL
WHERE catalog_version = 'online-v1' AND (active OR published_at IS NOT NULL);

UPDATE player.catalog_versions SET active = true, published_at = COALESCE(published_at, now())
WHERE catalog_version = 'online-v2' AND NOT active;

RESET ROLE;
