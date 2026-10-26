// Copies Go's versioned course manifests (the authority used by the Match
// Service) next to the page. The client only needs them to redraw a race it
// re-enters after a reload, when E43 replays room.state + snapshot but not
// race.start. A manifest version is immutable; CI fails if these copies differ.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../../../services/match-service-go/internal/race/courses/', import.meta.url);
const target = new URL('../dist/courses/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of (await readdir(source)).filter(file => file.endsWith('.json')).sort()) {
  await copyFile(new URL(name, source), new URL(name, target));
  console.log(`course ${name} -> ${fileURLToPath(new URL(name, target))}`);
}
