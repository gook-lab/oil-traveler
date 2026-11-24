// The sight lane of the travel walk: the trees that would stand above the far skyline. Beyond 300 m, inside 10 degrees
// either side of the first view's bearing, a tree's top must sit under the ranges' own top at that bearing (the highest
// band, on the scale the ranges are drawn at). The ground is squashed by VS and the trees are not, so without this the
// far trunks of the wood rise over the ranges. A tree is lowered to the line, or left out if too little of it is left.
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KEEP = 0.5; // the wood stays under half the skyline angle, so the far ranges show above it
const LANE_R = 300, LANE_HALF = (10 * Math.PI) / 180, MIN_SCALE = 0.2;

/**
 * Builds the lane test: (tree) => scale. `horizon` and `bands` are the place's skyline (real elevation angles, radians,
 * 360 bearings per band); `eye` is the eye's height in world metres; `VS` the ground's vertical scale; `gazeRad` the
 * bearing of the first view (0 north, clockwise).
 */
export function makeLane(horizon, bands, vantage, eye, VS, gazeRad) {
  const nb = bands.length;
  const ridge = new Float32Array(360);
  for (let a = 0; a < 360; a++) {
    let top = -Infinity;
    for (let b = 0; b < nb; b++) {
      const vs = VS + (1 - VS) * smoothstep(2000, 5000, bands[b]);
      top = Math.max(top, Math.atan(Math.tan(horizon[b * 360 + a]) * vs));
    }
    ridge[a] = top;
  }
  return (t) => {
    const dx = t.x - vantage.x, dz = t.z - vantage.z, d = Math.hypot(dx, dz);
    if (d <= LANE_R) return 1;
    const bearing = Math.atan2(dx, -dz); // the same convention as the bands: x = sin, z = -cos
    let diff = Math.abs(bearing - gazeRad) % (2 * Math.PI);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff > LANE_HALF) return 1;
    const deg = (((bearing * 180) / Math.PI) % 360 + 360) % 360;
    const line = ridge[Math.round(deg) % 360];
    const topY = t.y + t.h;
    if (Math.atan2(topY - eye, d) <= line * KEEP) return 1;
    // the tree height at which its top sits at KEEP of the line: the ranges show above the wood, not behind its crowns
    const s = (Math.tan(line * KEEP) * d + eye - t.y) / (topY - t.y);
    return s < MIN_SCALE ? 0 : Math.min(1, s);
  };
}
