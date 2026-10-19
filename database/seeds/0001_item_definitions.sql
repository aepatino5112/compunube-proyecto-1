-- IDs/types verified in apps/web/dist/economy.js. The online catalog and the 4 characters are published by migration 0002, not by this seed.
BEGIN;
INSERT INTO player.item_definitions (item_id, item_type) VALUES
  ('coral','board'), ('manglar','board'), ('sol','board'),
  ('costero','outfit'), ('brisa','outfit'), ('uva','outfit'),
  ('swept','hair'), ('curls','hair'), ('bun','hair'), ('ponytail','hair'), ('afro','hair'),
  ('red-base','net'), ('red-reuso','net'), ('red-marea','net'), ('red-cobre','net'),
  ('red-faro','net'), ('red-aurora','net'), ('red-sol','net')
ON CONFLICT (item_id) DO NOTHING;
COMMIT;
