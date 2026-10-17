export const MAX_LIVES = 3;
export const PROTECTION_SECONDS = 2.6;
export const freshSurvival = () => ({ lives: MAX_LIVES, protection: 0, disqualified: false });
export const freshChase = () => ({ gap: 48, retreat: 0 });

export function tickProtection(surfer, dt) {
  surfer.protection = Math.max(0, surfer.protection - dt);
}
export function takeHit(surfer) {
  if (surfer.disqualified || surfer.finishTime != null || surfer.protection > 0) return false;
  surfer.lives = Math.max(0, surfer.lives - 1);
  surfer.protection = PROTECTION_SECONDS;
  surfer.disqualified = surfer.lives === 0;
  return true;
}
export function recoverLife(surfer, pickup) {
  if (surfer.disqualified || surfer.finishTime != null || surfer.lives >= MAX_LIVES || pickup.collectedBy !== null) return false;
  surfer.lives++; pickup.collectedBy = surfer.index;
  return true;
}
// Distance is physical relative motion. Boost opens a gap; collisions let it close.
export function advanceChase(chase, speed, dt, elapsed) {
  if (elapsed < 6) return;
  if (chase.retreat > 0) {
    const retreatDt = Math.min(chase.retreat, dt);
    chase.gap = Math.min(64, chase.gap + retreatDt * 12);
    chase.retreat = Math.max(0, chase.retreat - dt);
  } else {
    chase.gap = Math.max(3.5, Math.min(64, chase.gap + (speed - 17.2) * dt));
  }
}
export function resolveChaseContact(chase, surfer) {
  if (chase.gap > 3.5 || chase.retreat > 0 || surfer.disqualified || surfer.finishTime != null) return false;
  // Retreat even if an obstacle just granted protection: no unavoidable second hit.
  chase.retreat = 3;
  return takeHit(surfer);
}
export function touchesPickup(start, end, pickup, radius = 1.7) {
  const dx = end.x - start.x, dz = end.z - start.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((pickup.x - start.x) * dx + (pickup.z - start.z) * dz) / length)) : 0;
  return (pickup.x - start.x - dx * t) ** 2 + (pickup.z - start.z - dz * t) ** 2 <= radius ** 2;
}
