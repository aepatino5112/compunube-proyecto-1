// Run in the full repository: node docs/backend/extract-fixtures.mjs
// Exports code defaults, never the browser's localStorage or a user's balance.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CATALOG, freshProfile } from '../../dist/economy.js';
import { CHARACTERS, SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from '../../dist/appearance.js';
import { MAPS, createCourse, COURSE_LENGTH, COURSE_WIDTH } from '../../dist/maps.js';
import { BOOST_PER_ITEM, BOOST_DRAIN_PER_SECOND, NET_LEFT_ANGLE } from '../../dist/mechanics.js';
import { MAX_LIVES, PROTECTION_SECONDS, freshChase } from '../../dist/survival.js';

const sources = ['economy', 'appearance', 'maps', 'mechanics', 'collection', 'survival', 'frame-clock', 'surf-motion', 'game', 'app', 'backend-config', 'multiplayer-client', 'multiplayer-lobby', 'network-race', 'network-presentation', 'online-profile', 'profile-panel'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [
  `dist/${name}.js`,
  createHash('sha256').update(await readFile(new URL(`../../dist/${name}.js`, import.meta.url))).digest('hex'),
])));

const fixture = {
  documentVersion: 1,
  status: 'current-local-frontend',
  note: 'Defaults extracted from code. Injectable room and profile clients exist; no service API, authentication or server is implemented.',
  sourceHashes,
  freshProfile: freshProfile(),
  catalog: CATALOG,
  characters: CHARACTERS,
  appearanceOptions: {skinTones: SKIN_TONES, hairColors: HAIR_COLORS, hairStyles: HAIR_STYLES},
  maps: MAPS,
  exportedConstants: {COURSE_LENGTH, COURSE_WIDTH, BOOST_PER_ITEM, BOOST_DRAIN_PER_SECOND, NET_LEFT_ANGLE, MAX_LIVES, PROTECTION_SECONDS},
  freshChase: freshChase(),
  courses: Object.fromEntries(MAPS.map(map => [map.id, {
    initialSeed: map.seed,
    ...createCourse(map.id),
  }])),
};
await writeFile(new URL('./fixtures/current-front.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
console.log('Backend fixtures extracted from current code defaults.');
