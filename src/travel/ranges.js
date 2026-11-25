// The far ranges of the travel walk: one silhouette per horizon band (place.meta.bands, six for a place baked at run
// time), each at its band's distance from the start, rising to the band's real elevation angle (place.horizon). The
// far ones are drawn first, so the near ones stand in front of them; the far ones are lighter and bluer and carry less
// contrast, and their strokes run level. Nothing is a fixed wall: the tops come from the ground the bake read, and the
// bottoms sit at the eye, so each range is a mass that rises from the horizon, not a plane over the sky.
import * as THREE from 'three';
import { COMMON } from '../oilpaint/common.js';

// the near band is well darker than the sky (about L* 40), the far one lies close to the sky (about L* 70)
const NEAR_COL = [0.3, 0.34, 0.38], FAR_COL = [0.6, 0.66, 0.74];
// The camera far plane is 2 km, so a range further out is drawn on a ring at CAP metres, at its own elevation angle: the
// angle is kept, the distance is not (the ranges are a backdrop, nothing walks to them). The rings are kept apart by
// STEP metres so their depths do not tie: the far one stands furthest, the near one in front of it.
const CAP = 1900, STEP = 10;
// the elevation (rad) the near band of a town may reach: roof height at 2 km, about 1 degree (38 m)
const TOWN_CAP = 0.02;
// a real mountain stays in a town (skyline-2): beyond the 1 km band, its mean height over the 21 bearings round it is at
// least MOUNT_M. A roof plateau at 2 km reads about 38 m, and a tower is narrow. Namsan from Myeongdong (1.3 km) reads
// 150 to 315 m on its bearings, while a town's roofs and towers at 1 km reach 90 to 250 m, so the 1 km band is always capped.
const MOUNT_M = 150, MOUNT_HALF = 10;
const SKIRT = (10 * Math.PI) / 180; // how far below the eye the skirt goes, as an angle at the band distance
// below the eye the ranges turn to the far ground, not to the sky's blue: dusty green-grey, nearer bands darker, far ones paler
const LAND_NEAR = [0.36, 0.42, 0.34], LAND_FAR = [0.5, 0.55, 0.5];
// check only: ?skirt=0 leaves the skirt out, to measure what it changes
const skirtOn = typeof location === 'undefined' || new URLSearchParams(location.search).get('skirt') !== '0';
// The vertical scale: the walk squashes the ground by VS (0.5), so the mid-ground and the near skyline are read at VS.
// The far ranges are real peaks, and they take the full scale by 5 km (smoothstep from 2 km), so no seam shows at 2 km.
const FAR_VS = 1.0;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** True when the bearing a of band b is a real mountain: its mean height (m) over MOUNT_HALF bearings either side is MOUNT_M or more. */
function isMountain(horizon, b, a, d) {
  let s = 0;
  for (let k = -MOUNT_HALF; k <= MOUNT_HALF; k++) s += Math.max(0, d * Math.tan(horizon[b * 360 + ((a + k + 360) % 360)]));
  return s / (2 * MOUNT_HALF + 1) >= MOUNT_M;
}

/**
 * Builds the ranges. `horizon` is 360 bearings per band (0 north, clockwise; radians of elevation, from the eye); `bands`
 * the band distances in metres; the eye stands at (ex, ey, ez) in world metres; `VS` is the vertical scale of the ground
 * (the angles are of the true ground, the world's ground is scaled by VS, so the tops are scaled the same way).
 */
export function createRanges(shared, horizon, bands, ex, ey, ez, VS, { urban = false } = {}) {
  const group = new THREE.Group();
  const nb = bands.length;
  for (let b = nb - 1; b >= 0; b--) {
    const bots = new Float32Array(361 * 2); // the bottom height of each vertex, read in the shader for the far-ground colour
    const d = bands[b], t = nb > 1 ? b / (nb - 1) : 0; // t: 0 near, 1 far
    const dp = d <= CAP ? d : CAP - STEP * (nb - 1 - b); // where the ring stands
    const vs = VS + (FAR_VS - VS) * smooth(2000, 5000, d);
    const pos = new Float32Array(361 * 2 * 3);
    for (let a = 0; a <= 360; a++) {
      const az = (a * Math.PI) / 180;
      // a town: the DSM reads the roofs of the near 2 km as a plateau, a flat wall. Its top is held low, so the far city
      // stands in front of it; the real ranges (the bands beyond 2 km) keep their angles
      let th = horizon[b * 360 + (a % 360)];
      if (urban && d <= 2000 && !(d > 1000 && isMountain(horizon, b, a, d))) th = Math.min(th, TOWN_CAP);
      const top = ey + dp * Math.tan(th) * vs;
      // the skirt: the band reaches down below the eye, so where the ground falls away (a bearing under the horizon) it is
      // not left as background. The nearer picture stands in front of it (the depth test); the skirt fills only the gap
      const bottom = Math.min(top, ey) - dp * Math.tan(SKIRT);
      const x = ex + Math.sin(az) * dp, z = ez - Math.cos(az) * dp;
      pos.set([x, top, z], a * 6);
      pos.set([x, bottom, z], a * 6 + 3);
      bots[a * 2] = bots[a * 2 + 1] = skirtOn ? bottom : top;
    }
    const index = [];
    for (let a = 0; a < 360; a++) {
      const p = a * 2, q = p + 1, r = p + 2, s = p + 3;
      index.push(p, q, r, q, s, r); // counter-clockwise seen from inside the ring: the front faces the eye
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aBot', new THREE.BufferAttribute(bots, 1));
    geometry.setIndex(index);
    const near = NEAR_COL, far = FAR_COL;
    const col = near.map((v, i) => v + (far[i] - v) * t);
    const land = LAND_NEAR.map((v, i) => v + (LAND_FAR[i] - v) * t);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: shared,
      vertexShader: /* glsl */ `
        ${COMMON}
        in float aBot;
        out vec3 vWorld;
        out float vBot;
        void main() { vWorld = position; vBot = aBot; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        in vec3 vWorld;
        in float vBot;
        layout(location = 0) out vec4 outC;
        void main() {
          // level strokes: the noise stretched along the bearing, not up the slope
          float s = texture(tNoise, vec2(atan(vWorld.x, vWorld.z) * 60.0, vWorld.y * 0.12) / 95.0).r;
          vec3 c = vec3(${col.map((v) => v.toFixed(3)).join(', ')}) * (0.93 + 0.14 * s);
          // below the eye, the band becomes the far ground (its gradient runs from the eye down to its skirt)
          float below = clamp((${ey.toFixed(3)} - vWorld.y) / max(${ey.toFixed(3)} - vBot, 1e-3), 0.0, 1.0);
          vec3 land = vec3(${land.map((v) => v.toFixed(3)).join(', ')}) * (0.93 + 0.14 * s);
          c = mix(c, land, below);
          // the air takes more of the far ones, so they lie flat against the sky
          vec3 air = airColour(normalize(vWorld - cameraPosition));
          outC = vec4(mix(c, air, clamp(${(0.1 + 0.15 * t).toFixed(3)} * mistBetween(vWorld) + 0.05, 0.0, 1.0)), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -b; // far (large b) first
    group.add(mesh);
  }
  return group;
}
