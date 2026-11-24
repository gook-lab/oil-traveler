// The ground of the hwadam walk: the real ground of the garden (src/hwadam/data/near.bin, baked by tools/fetch-dem.mjs
// from SRTM) at a vertical scale of VS, with the same small noise the autumn wood has, and the way drawn over it
// (src/hwadam/data/way.json, from tools/make-way.mjs). A map of where along the way each spot lies is kept in the
// alpha of the land map, read by the shaders through segW. The same height is used by the picture, by the wanderer's
// feet (a height field for the physics) and by everything planted on it.
import * as THREE from 'three';
import { COMMON, EXTENT, LAND_RES } from '../../oilpaint/common.js';
import { noise, rng } from '../../world/noise.js';
import { segW, SEG_GLSL } from './segments.js';
export { noise, rng, segW };

/** Vertical scale on the real ground (1 would be true). Chosen because the true slopes are steep; see PLAN.md. */
export const VS = 0.5;

// --- the way through ---------------------------------------------------------------------------------------------
// The ground is set by setPlace() (src/hwadam/world/place.js: the baked Hwadam data, or a place baked at run time)
// before prepareLand(). The objects below are filled in place, so every module that imported them sees the change.
export const START = { x: 0, z: 0 };
export const CLEARING = { x: 0, z: 0, r: 21 };
/**
 * Where no trunk stands at the travel start: a ring of r metres about the pin, and a fan of half-angle fanCos (cosine)
 * out to fanR metres along (fx, fz), the first view. fan false, r 0: none (the baked Hwadam walk).
 */
export const CLEAR = { x: 0, z: 0, r: 0, fan: false, fx: 0, fz: -1, fanR: 40, fanCos: 1, laneR: 300, laneCos: 1, sightCos: 1, lowH: 1 };
/** The walk as dense samples (world metres, x east, z south), a Catmull-Rom curve through the control points. */
export const way = [];
let NEAR_N = 0, NEAR_STEP = 1, near = null, H0 = 0;
/** Metres from (x, z) to the middle of the way. */
export function wayDist(x, z) {
  let best = Infinity;
  for (let i = 0; i < way.length - 1; i++) {
    const [ax, az] = way[i], [bx, bz] = way[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}
/** Where (x, z) lies along the way: 0 at its first point, 1 at its last, by the nearest sample on it. */
export function pathT(x, z) {
  let best = Infinity, at = 0;
  for (let i = 0; i < way.length; i++) {
    const d = (way[i][0] - x) ** 2 + (way[i][1] - z) ** 2;
    if (d < best) { best = d; at = i; }
  }
  return at / (way.length - 1);
}
export const clearingAt = (x, z) => {
  const d = Math.hypot(x - CLEARING.x, z - CLEARING.z) + noise(x * 0.11, z * 0.11) * 3.5;
  return 1 - Math.min(1, Math.max(0, (d - CLEARING.r * 0.72) / (CLEARING.r * 0.5)));
};

/**
 * Takes a ground (see place.js): its near square, its way (control points, the entrance and the goal) and its meta.
 * Call before prepareLand(). The control points become the dense samples above, as the autumn walk always did.
 */
export function setPlace(place) {
  NEAR_N = place.meta.nearN;
  NEAR_STEP = place.meta.nearStep;
  near = place.near;
  H0 = place.way.startHeight; // the entrance is the zero of the scaled ground
  START.x = place.way.start[0]; START.z = place.way.start[1];
  CLEARING.x = place.way.goal[0]; CLEARING.z = place.way.goal[1];
  const WAY = place.way.points;
  way.length = 0;
  const at = (i) => WAY[Math.max(0, Math.min(WAY.length - 1, i))];
  for (let i = 0; i < WAY.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const c = (a, b, c_, d) => 0.5 * (2 * b + (-a + c_) * t + (2 * a - 5 * b + 4 * c_ - d) * t2 + (-a + 3 * b - 3 * c_ + d) * t3);
      way.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  way.push(WAY[WAY.length - 1]);
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// --- the real ground ---------------------------------------------------------------------------------------------
/** The real ground at world (x, z): bilinear over the baked square, clamped to its edges. z is south, so row j = N/2 - z/step. */
function groundAt(x, z) {
  const fi = Math.min(NEAR_N - 1.001, Math.max(0, x / NEAR_STEP + NEAR_N / 2));
  const fj = Math.min(NEAR_N - 1.001, Math.max(0, NEAR_N / 2 - z / NEAR_STEP));
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
  const a = near[i + j * NEAR_N], b = near[i + 1 + j * NEAR_N], c = near[i + (j + 1) * NEAR_N], d = near[i + 1 + (j + 1) * NEAR_N];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// --- maps ------------------------------------------------------------------------------------------------------
const N = LAND_RES;
const TEXEL_M = (2 * EXTENT) / (N - 1);
const heights = new Float32Array(N * N);
const land = new Uint8Array(N * N * 4);

/**
 * Works the maps out, a million points of ground. It takes a second or so, so it stops every few rows and waits
 * for `pause(done 0..1)`, which lets the page breathe. Nothing here can be used before it has finished.
 * The distance to the way and the place along it come from one pass of a distance transform, not a search per point.
 */
export async function prepareLand(pause) {
  if (!near) throw new Error('prepareLand before setPlace');
  if (near.length !== NEAR_N * NEAR_N) throw new Error('the near square does not match its meta');

  // distance transform (two passes, 1 and sqrt 2 steps), carrying the nearest sample's number with it
  const dist = new Float32Array(N * N).fill(Infinity), label = new Int32Array(N * N).fill(-1);
  const toTexel = (v) => Math.round(((v + EXTENT) / (2 * EXTENT)) * (N - 1));
  way.forEach(([x, z], k) => {
    const ti = toTexel(x), tj = toTexel(z);
    if (ti >= 0 && ti < N && tj >= 0 && tj < N) { dist[tj * N + ti] = 0; label[tj * N + ti] = k; }
  });
  const relax = (idx, from, add) => { const v = dist[from] + add; if (v < dist[idx]) { dist[idx] = v; label[idx] = label[from]; } };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const idx = j * N + i;
    if (i > 0) relax(idx, idx - 1, 1);
    if (j > 0) { relax(idx, idx - N, 1); if (i > 0) relax(idx, idx - N - 1, Math.SQRT2); if (i < N - 1) relax(idx, idx - N + 1, Math.SQRT2); }
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const idx = j * N + i;
    if (i < N - 1) relax(idx, idx + 1, 1);
    if (j < N - 1) { relax(idx, idx + N, 1); if (i < N - 1) relax(idx, idx + N + 1, Math.SQRT2); if (i > 0) relax(idx, idx + N - 1, Math.SQRT2); }
  }

  for (let j = 0; j < N; j++) {
    if (pause && j % 24 === 0) await pause(j / N);
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + (i / (N - 1)) * 2 * EXTENT, z = -EXTENT + (j / (N - 1)) * 2 * EXTENT;
      const idx = j * N + i;
      const wd = dist[idx] * TEXEL_M;
      const ground = (groundAt(x, z) - H0) * VS;
      // the same small noise the autumn wood has, and the way worn a little into the ground
      heights[idx] = ground + 0.3 * noise(x / 8.3, z / 8.3) - 0.28 * Math.exp(-(wd * wd) / 3.2);
      const k = idx * 4;
      const ragged = noise(x * 0.9, z * 0.9) * 0.35 + noise(x * 0.23, z * 0.23) * 0.5;
      land[k] = Math.round(255 * (1 - sstep(0.75, 1.9, wd + ragged)));
      land[k + 1] = Math.round(255 * clearingAt(x, z));
      land[k + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + 0.6 * noise(x / 17 + 9, z / 17) + 0.3 * noise(x / 5, z / 5 + 4))));
      // along the way: the nearest sample's place on it (0 at the first point, 1 at the last)
      land[k + 3] = Math.round(255 * (label[idx] >= 0 ? label[idx] / (way.length - 1) : 0));
    }
  }
}
/** Height of the ground at (x, z), read from the same map the picture uses. */
/**
 * A vantage point near the pin (travel start): the highest ground within `radius` metres of the pin, over the square's
 * inner part, with a small pull toward the pin itself. A hill gives the first view down over the valley; a flat place
 * gives the pin. Needs prepareLand() first (it reads the heights).
 */
export function vantageNear(radius = 150, step = 10) {
  let best = { x: 0, z: 0, h: -Infinity, score: -Infinity };
  for (let z = -radius; z <= radius; z += step) {
    for (let x = -radius; x <= radius; x += step) {
      const d = Math.hypot(x, z);
      if (d > radius || Math.abs(x) > EXTENT - 20 || Math.abs(z) > EXTENT - 20) continue;
      const h = heightAt(x, z), score = h - 0.02 * d;
      if (score > best.score) best = { x, z, h, score };
    }
  }
  return { x: best.x, z: best.z, h: best.h };
}

export function heightAt(x, z) {
  const fx = Math.min(N - 1.001, Math.max(0, ((x + EXTENT) / (2 * EXTENT)) * (N - 1)));
  const fz = Math.min(N - 1.001, Math.max(0, ((z + EXTENT) / (2 * EXTENT)) * (N - 1)));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = heights[i + j * N], b = heights[i + 1 + j * N], c = heights[i + (j + 1) * N], d = heights[i + 1 + (j + 1) * N];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

export function createLand(shared) {
  const tHeight = new THREE.DataTexture(heights, N, N, THREE.RedFormat, THREE.FloatType);
  tHeight.minFilter = tHeight.magFilter = THREE.LinearFilter;
  tHeight.needsUpdate = true;
  const tLand = new THREE.DataTexture(land, N, N);
  tLand.minFilter = tLand.magFilter = THREE.LinearFilter;
  tLand.needsUpdate = true;
  shared.tHeight.value = tHeight;
  shared.tLand.value = tLand;

  // the ground itself only carries the underpainting: a dark warm tone that shows between the dabs laid over it
  // it lies a few centimetres under the true ground, so that no facet of it can cover a leaf lying on the ground
  const seg = 512;
  const geometry = new THREE.PlaneGeometry(2 * EXTENT, 2 * EXTENT, seg, seg);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - 0.04);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    vertexShader: /* glsl */ `
      ${COMMON}
      out vec3 vWorld;
      void main() { vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SEG_GLSL}
      in vec3 vWorld;
      layout(location = 0) out vec4 outC;
      void main() {
        vec4 m = texture(tLand, landUv(vWorld.xz));
        vec4 sw = segW(m.a);
        // the underpainting by the part of the walk: dark moss in the garden, plum and rust on the climb,
        // ochre among the birches, gold on the rise
        vec3 deep = sw.x * vec3(0.16, 0.2, 0.12) + sw.y * vec3(0.34, 0.13, 0.11) + sw.z * vec3(0.4, 0.33, 0.18) + sw.w * vec3(0.5, 0.34, 0.12);
        vec3 bright = sw.x * vec3(0.28, 0.34, 0.2) + sw.y * vec3(0.64, 0.2, 0.12) + sw.z * vec3(0.7, 0.6, 0.3) + sw.w * vec3(0.8, 0.6, 0.22);
        // laid in broadly first: bright where the sun falls, deep where it doesn't
        // asked square by ragged square, so that what shows between the dabs is itself in touches
        vec2 sq = floor(vWorld.xz / 0.32 + (texture(tNoise, vWorld.xz / 2.3).rg - 0.5) * 1.8) * 0.32;
        float lit = step(0.5, woodSunAt(vec3(sq.x, vWorld.y + 0.2, sq.y)));
        vec3 c = mix(deep, bright, lit);
        c = mix(c, mix(vec3(0.21, 0.17, 0.2), vec3(0.6, 0.47, 0.33), lit), m.r); // the way itself, worn bare
        c *= 0.78 + 0.3 * texture(tNoise, vWorld.xz / 9.0).r;
        outC = vec4(hazed(c, vWorld), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  /** Heights for the physics: `cells` squares a side over the middle `half` metres, column by column. */
  function heightField(cells = 384, half = 192) {
    const out = new Float32Array((cells + 1) * (cells + 1));
    for (let col = 0; col <= cells; col++) {
      for (let row = 0; row <= cells; row++) {
        out[row + col * (cells + 1)] = heightAt(-half + (col / cells) * 2 * half, -half + (row / cells) * 2 * half);
      }
    }
    return { heights: out, cells, half };
  }
  return { mesh, heightField };
}
