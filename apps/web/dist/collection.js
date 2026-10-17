// Collect only unclaimed items touched by the net at water level.
// The swept segment prevents skipped pickups at higher speeds or low frame rates.
export function collectTrash(items, start, end, owner, jumpHeight, radius = 1.25) {
  if (jumpHeight > .45) return [];
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const collected = [];
  for (const item of items) {
    if (item.collectedBy !== null) continue;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((item.x - start.x) * dx + (item.z - start.z) * dz) / lengthSquared));
    const distanceSquared = (item.x - start.x - dx * t) ** 2 + (item.z - start.z - dz * t) ** 2;
    if (distanceSquared <= radius * radius) { item.collectedBy = owner; collected.push(item); }
  }
  return collected;
}
