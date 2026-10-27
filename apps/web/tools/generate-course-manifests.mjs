// Writes Go's versioned course manifests from the deterministic generator in
// dist/maps.js. A version is immutable once released: run this only to create a
// new one, then `npm run build` copies it next to the page.
//   node tools/generate-course-manifests.mjs surf-mvp-2 1800
//   node tools/generate-course-manifests.mjs --check surf-mvp-1 900
import { readFile, writeFile } from 'node:fs/promises';
import { MAPS, createCourse, COURSE_WIDTH } from '../dist/maps.js';

const args = process.argv.slice(2);
const check = args[0] === '--check';
const [version, length] = check ? args.slice(1) : args;
if (!/^surf-mvp-\d+$/.test(version || '') || !(Number(length) > 0)) throw new Error('usage: [--check] surf-mvp-N <length>');
const id = (prefix, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`;
const KINDS = ['bottle', 'pipe', 'wrapper'];

for (const map of MAPS) {
  const course = createCourse(map.id, Number(length));
  const manifest = {
    mapId: map.id,
    courseVersion: `${map.id}-${version}`,
    lengthUnits: Number(length),
    lateralLimitUnits: COURSE_WIDTH,
    startSlotsX: [-9, -3, 3, 9],
    obstacles: course.obstacles.map((o, i) => ({ itemId: id('o', i), x: o.x, z: o.z, radius: o.radius })),
    trash: course.trash.map((t, i) => ({ itemId: id('t', i), x: t.x, z: t.z, kind: KINDS[t.kind],
      material: KINDS[t.kind] === 'pipe' ? 'metal' : 'plastic', rotation: t.rotation, phase: t.phase })),
    lifesavers: course.lifesavers.map((l, i) => ({ itemId: id('l', i), x: l.x, z: l.z })),
  };
  const file = new URL(`../../../services/match-service-go/internal/race/courses/${manifest.courseVersion}.json`, import.meta.url);
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (check) {
    if (await readFile(file, 'utf8') !== text) throw new Error(`${manifest.courseVersion} differs from the generator`);
    console.log(`${manifest.courseVersion}: identical`);
  } else {
    await writeFile(file, text);
    console.log(`${manifest.courseVersion}: ${manifest.obstacles.length} obstacles, ${manifest.trash.length} trash, ${manifest.lifesavers.length} lifesavers`);
  }
}
