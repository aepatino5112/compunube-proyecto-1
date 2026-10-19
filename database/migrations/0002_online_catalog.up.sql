-- F52 online catalog and rejection storage. Run only via 0002_apply.sql, as a
-- privileged migrator, after 0001. Every statement is idempotent so a manual
-- re-run is harmless; 0002_apply.sql additionally records version 0002.
--
-- Economy values are copied verbatim from apps/web/dist/economy.js and
-- apps/web/dist/appearance.js. Exchange rates and the skin/hair colour options
-- have no table: they are constants of the Rust domain bound to `online-v1`.
SET ROLE compunube_migrator;

-- E1: a rejected request is stored with its contract code so a retry returns
-- the same business result. NULL for applied operations.
ALTER TABLE player.economic_operations ADD COLUMN IF NOT EXISTS rejection_code TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'player.economic_operations'::regclass AND conname = 'economic_operations_rejection_code_check') THEN
    ALTER TABLE player.economic_operations ADD CONSTRAINT economic_operations_rejection_code_check CHECK (
      rejection_code IS NULL OR rejection_code IN (
        'INVALID_ACTION', 'INVALID_ITEM', 'INSUFFICIENT_COINS', 'INSUFFICIENT_MATERIALS',
        'NOT_OWNED', 'ALREADY_OWNED', 'INVALID_APPEARANCE', 'IDEMPOTENCY_CONFLICT',
        'INVALID_CATALOG_VERSION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'player.economic_operations'::regclass AND conname = 'economic_operations_status_rejection_check') THEN
    ALTER TABLE player.economic_operations ADD CONSTRAINT economic_operations_status_rejection_check
      CHECK ((status = 'rejected') = (rejection_code IS NOT NULL));
  END IF;
END $$;

-- E3: all 22 item ids exist (the 18 of seeds/0001 plus the 4 characters).
INSERT INTO player.item_definitions (item_id, item_type) VALUES
  ('nico', 'character'),
  ('luna', 'character'),
  ('amara', 'character'),
  ('samuel', 'character'),
  ('coral', 'board'),
  ('manglar', 'board'),
  ('sol', 'board'),
  ('costero', 'outfit'),
  ('brisa', 'outfit'),
  ('uva', 'outfit'),
  ('swept', 'hair'),
  ('curls', 'hair'),
  ('bun', 'hair'),
  ('ponytail', 'hair'),
  ('afro', 'hair'),
  ('red-base', 'net'),
  ('red-reuso', 'net'),
  ('red-marea', 'net'),
  ('red-cobre', 'net'),
  ('red-faro', 'net'),
  ('red-aurora', 'net'),
  ('red-sol', 'net')
ON CONFLICT (item_id) DO NOTHING;

-- E2: `online-v1` is published and becomes the active version unless another
-- version is already active (the unique index allows a single active one).
INSERT INTO player.catalog_versions (catalog_version, active, published_at)
SELECT 'online-v1', NOT EXISTS (SELECT 1 FROM player.catalog_versions WHERE active), now()
ON CONFLICT (catalog_version) DO NOTHING;

-- E5/E6: price NULL means "not for sale"; items with a recipe are crafted.
-- Colour, rarity and the character look live in metadata as strings.
INSERT INTO player.catalog_entries
  (catalog_version, item_id, name, description, price_coins, recipe_plastic, recipe_metal, metadata)
SELECT 'online-v1', v.item_id, v.name, v.description, v.price_coins, v.recipe_plastic, v.recipe_metal, v.metadata
FROM (VALUES
  ('nico', 'Nico', 'Hombros amplios, mangas navy y bermudas con paneles claros. Su chaleco lleva una V que sigue el ritmo de la ola.', 0, 0, 0, '{"gender":"Hombre","skin":"medium","hairColor":"brown","hair":"swept"}'::jsonb),
  ('luna', 'Luna', 'Paneles lavanda, short deportivo y una coleta agrupada que acompaña el giro. Su lugar favorito está entre el sol y el agua.', 0, 0, 0, '{"gender":"Mujer","morph":"Luna","skin":"light","hairColor":"blonde","hair":"ponytail"}'::jsonb),
  ('amara', 'Amara', 'Rizos con volumen, chaleco con paneles claros y una silueta deportiva. Lleva el ritmo del club.', 0, 0, 0, '{"gender":"Mujer","morph":"Amara","skin":"dark","hairColor":"black","hair":"afro"}'::jsonb),
  ('samuel', 'Samuel', 'Figura esbelta, lycra teal y ocre, bermudas largas y rizos cobrizos. Cada recorrido es una nueva historia.', 0, 0, 0, '{"gender":"Hombre","morph":"Samuel","skin":"dark","hairColor":"copper","hair":"curls"}'::jsonb),
  ('coral', 'Coral', 'Tu primera compañera de olas. Ligera, cálida y lista para volver al agua.', 0, 0, 0, '{"color":"#ef795e"}'::jsonb),
  ('manglar', 'Manglar', 'Cola de pez, listones de madera recuperada y dos quillas. Una compañera con carácter de manglar.', 60, 0, 0, '{"color":"#378875"}'::jsonb),
  ('sol', 'Sol del lago', 'Una tabla redondeada con rayos de coral y líneas crema. Un poco del sol de Maracaibo para cada recorrido.', 100, 0, 0, '{"color":"#e8bb53"}'::jsonb),
  ('costero', 'Costero', 'El uniforme del club. Hecho para acompañarte muchas carreras.', 0, 0, 0, '{"color":"#ef795e"}'::jsonb),
  ('brisa', 'Brisa', 'Azul de cielo para una nueva vuelta por el lago.', 40, 0, 0, '{"color":"#749dcc"}'::jsonb),
  ('uva', 'Atardecer', 'Una paleta tranquila para dejar una buena huella.', 80, 0, 0, '{"color":"#a28abc"}'::jsonb),
  ('swept', 'Al viento', 'Mechones peinados hacia atrás y una nuca corta. Disponible para todo el club.', 0, 0, 0, '{"color":"#54321f"}'::jsonb),
  ('curls', 'Rizos', 'Una corona de rizos con volumen y silueta propia. Disponible para todo el club.', 0, 0, 0, '{"color":"#382219"}'::jsonb),
  ('bun', 'Recogido', 'Cabello recogido con moño y mechones marcados. Disponible para todo el club.', 0, 0, 0, '{"color":"#66341e"}'::jsonb),
  ('ponytail', 'Coleta', 'Coleta larga con mechones curvos y una banda de tela. Disponible para todo el club.', 0, 0, 0, '{"color":"#e9bd60"}'::jsonb),
  ('afro', 'Afro', 'Rizos amplios que forman una silueta redondeada con volumen propio. Disponible para todo el club.', 0, 0, 0, '{"color":"#29201d"}'::jsonb),
  ('red-base', 'Red costera', 'Tu recogedor de confianza. Cambia de lado con Z y X.', 0, 0, 0, '{"color":"#2e7373","rarity":"Común"}'::jsonb),
  ('red-reuso', 'Red reutilizada', 'Marco cuadrado de esquinas suaves, mango de madera y uniones recuperadas. Tus materiales vuelven al agua como herramienta.', NULL, 6, 3, '{"color":"#e8b753","rarity":"Común"}'::jsonb),
  ('red-marea', 'Red marea', 'Marco ovalado de doble aro y bolsa profunda en U. Una segunda vida para el plástico y la chatarra.', NULL, 10, 5, '{"color":"#a38bc4","rarity":"Destacada"}'::jsonb),
  ('red-cobre', 'Cobre', 'Mango de cobre recuperado y aro hexagonal. Un acabado cálido con uniones visibles.', NULL, 12, 8, '{"color":"#c8855d","rarity":"Destacada"}'::jsonb),
  ('red-faro', 'Faro', 'Mango de acero, aro octagonal y bandas de luz verde agua. Un faro pequeño para tu estilo.', NULL, 16, 10, '{"color":"#52c9b3","rarity":"Especial"}'::jsonb),
  ('red-aurora', 'Aurora', 'Acero, aro en forma de gota y luces azules. La bolsa conserva su fondo en U.', NULL, 20, 12, '{"color":"#789af1","rarity":"Especial"}'::jsonb),
  ('red-sol', 'Sol del puente', 'Aro ancho de doble borde y bandas ámbar sobre acero. Un recuerdo del sol de Maracaibo.', NULL, 24, 16, '{"color":"#e9b44d","rarity":"Especial"}'::jsonb)
) AS v(item_id, name, description, price_coins, recipe_plastic, recipe_metal, metadata)
ON CONFLICT (catalog_version, item_id) DO NOTHING;

RESET ROLE;
