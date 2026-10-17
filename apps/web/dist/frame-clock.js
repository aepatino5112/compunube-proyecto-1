// Rendering supplies time; gameplay consumes bounded, fixed steps. Long stalls
// request a pause instead of silently slowing the race or catching up offscreen.
export function createFrameClock({ step = 1 / 60, maxGap = .5 } = {}) {
  let previous = null, pending = 0;
  return {
    reset() { previous = null; pending = 0; },
    tick(now, active, update) {
      const gap = previous === null ? 0 : Math.max(0, (now - previous) / 1000);
      previous = now;
      if (!active || gap > maxGap) {
        pending = 0;
        return { dt: 0, stalled: active && gap > maxGap };
      }
      pending += gap;
      let dt = 0;
      while (pending + 1e-9 >= step) {
        pending = Math.max(0, pending - step); dt += step;
        if (update(step) === false) { pending = 0; break; }
      }
      return { dt, stalled: false };
    },
  };
}
