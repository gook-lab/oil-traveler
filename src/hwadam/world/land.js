// The ground of the hwadam walk: the real ground of the garden (src/hwadam/data/near.bin, baked by tools/fetch-dem.mjs
// from SRTM) at a vertical scale of VS, with the same small noise the autumn wood has, and the way drawn over it
// (src/hwadam/data/way.json, from tools/make-way.mjs). A map of where along the way each spot lies is kept in the
// alpha of the land map, read by the shaders through segW. The same height is used by the picture, by the wanderer's
// feet (a height field for the physics) and by everything planted on it.
import * as THREE from 'three';
import { COMMON, EXTENT, LAND_RES } from '../../oilpaint/common.js';
import { noise, rng } from '../../world/noise.js';
import { segW, SEG_GLSL } from './segments.js';
import { setCover, hasCover, coverTexture, coniferShare, COVER_GLSL, TRAVEL_VS } from './cover.js';
export { noise, rng, segW };

/** Vertical scale on the real ground (1 would be true). Chosen because the true slopes are steep; see PLAN.md. */
export const VS = 0.5;
// the scale in use: VS for the baked walk, TRAVEL_VS for a place baked at run time (set by setPlace)
let vs = VS;
export function verticalScale() { return vs; }

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
  vs = place.source === 'runtime' ? TRAVEL_VS : VS;
  // the land cover of a place baked at run time (T2); the baked walk has none and keeps its look
  setCover(place.cover?.grid ?? null, place.cover ? coniferShare(place.meta.center.lat, H0) : 0, place.cover?.depth ?? null);
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
      const ground = (groundAt(x, z) - H0) * vs;
      // the same small noise the autumn wood has, and the way worn a little into the ground
      heights[idx] = ground + 0.3 * noise(x / 8.3, z / 8.3) - 0.28 * Math.exp(-(wd * wd) / 3.2);
      const k = idx * 4;
      const ragged = noise(x * 0.9, z * 0.9) * 0.35 + noise(x * 0.23, z * 0.23) * 0.5;
      land[k] = Math.round(255 * (1 - sstep(0.75, 1.9, wd + ragged)));
      land[k + 1] = Math.round(255 * clearingAt(x, z));
      land[k + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + 0.6 * noise(x / 17 + 9, z / 17) + 0.3 * noise(x / 5, z / 5 + 4))));
      // along the way: the nearest sample's place on it (0 at the first point, 1 at the last)
      // a place with its land cover (T2) is painted as the maple climb throughout (autumn ground, no garden moss):
      // the walk's parts mean nothing there
      land[k + 3] = hasCover() ? 128 : Math.round(255 * (label[idx] >= 0 ? label[idx] / (way.length - 1) : 0));
    }
  }
}
/** Height of the ground at (x, z), read from the same map the picture uses. */
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
  shared.tCover = { value: coverTexture() };
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
      ${COVER_GLSL}
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
        // the ground of a place (T2), painted in dabs of its own: sea, sand, rock and built-up ground. Each class has a
        // stroke texture (long flat strokes on water and sand, short coarse ones on rock), so no class reads as a flat fill
        float cls = coverClass(vWorld.xz);
        vec2 sq2 = floor(vWorld.xz / 0.5 + (texture(tNoise, vWorld.xz / 2.3).rg - 0.5) * 1.4) * 0.5;
        float sqn = texture(tNoise, sq2 / 9.0).r;
        float strokeH = texture(tNoise, vec2(vWorld.x / 6.0, vWorld.z / 0.9)).r; // long along x
        float strokeV = texture(tNoise, vec2(vWorld.x / 1.3, vWorld.z / 2.6)).g; // short, coarse
        // how much of the water lies next to this node, sampled a metre and a half off on four sides: the shore
        // breaks into dabs (a dab of water where the noise falls under the share), not a stair of cells
        float wet = 0.0, rockNear = 0.0;
        for (int q = 0; q < 4; q++) {
          vec2 o = vec2(q == 0 ? 1.5 : q == 1 ? -1.5 : 0.0, q == 2 ? 1.5 : q == 3 ? -1.5 : 0.0);
          float o2 = coverClass(vWorld.xz + o * 2.0);
          wet += abs(o2 - 9.0) < 0.5 ? 0.25 : 0.0;
          rockNear = max(rockNear, abs(o2 - 9.0) < 0.5 ? 1.0 : 0.0);
        }
        // the shore is a curve, not the 2 m cell stairs: the share of water among nine points 2.5 m apart, with the dab
        // noise pushing the line either way; a point is water where that share passes one half
        float wf = 0.0;
        for (int gy = -1; gy <= 1; gy++) for (int gx = -1; gx <= 1; gx++) {
          wf += abs(coverClass(vWorld.xz + vec2(float(gx), float(gy)) * 2.5) - 9.0) < 0.5 ? 1.0 : 0.0;
        }
        wf /= 9.0;
        // a water cell is always water (else it kept the autumn underpainting, rust red); the noisy line only moves sand and bare ground
        bool isWater = abs(cls - 9.0) < 0.5 || (wf + (sqn - 0.5) * 0.45 > 0.5 && (cls < 0.5 || abs(cls - 6.0) < 0.5));
        if (isWater) {
          // water as the night fjord paints it (src/night/far.js): long strokes lying flat, the shallows emerald and
          // the deep teal, and a grazing look that gives back the sky; a white line of foam where sand or rock meets it
          float dep = coverDepth(vWorld.xz);
          vec3 wc = mix(vec3(0.3, 0.8, 0.66), vec3(0.04, 0.3, 0.42), smoothstep(0.0, 6.0, dep));
          wc *= 0.8 + 0.34 * strokeH;
          float graze = pow(1.0 - clamp(-normalize(vWorld - cameraPosition).y, 0.0, 1.0), 3.0);
          wc = mix(wc, vec3(0.62, 0.78, 0.82), graze * 0.35);
          float land3 = 0.0;
          for (int q = 0; q < 4; q++) {
            vec2 o = vec2(q == 0 ? 3.0 : q == 1 ? -3.0 : 0.0, q == 2 ? 3.0 : q == 3 ? -3.0 : 0.0);
            float o2 = coverClass(vWorld.xz + o);
            land3 = max(land3, (abs(o2 - 6.0) < 0.5 || abs(o2 - 5.0) < 0.5) ? 1.0 : 0.0);
          }
          float foam = land3 * smoothstep(0.5, 0.75, texture(tNoise, vec2(vWorld.x / 4.0, vWorld.z / 0.6)).g);
          c = mix(wc * (0.85 + 0.25 * lit), vec3(0.94, 0.97, 0.94), foam);
        } else if (abs(cls - 6.0) < 0.5 || (cls < 0.5 && wf > 0.0)) {
          // (untagged land by the water is beach too: it would otherwise keep the maple climb's rust underpainting)
          // sand: pale warm, in long flat strokes; where the sea reaches it, the water breaks in dabs over it
          vec3 sc = mix(vec3(0.8, 0.7, 0.52), vec3(0.95, 0.87, 0.68), sqn) * (0.9 + 0.2 * strokeH);
          c = sc;
          if (wet > 0.0 && sqn < wet) c = mix(vec3(0.2, 0.62, 0.58), vec3(0.3, 0.8, 0.66), strokeH);
        } else if (abs(cls - 5.0) < 0.5) {
          if (rockNear > 0.5) {
            // the rock by the sea is basalt (dark, in coarse dark strokes), as on Jeju
            c = mix(vec3(0.2, 0.2, 0.22), vec3(0.36, 0.34, 0.36), strokeV) * (0.85 + 0.3 * sqn);
          } else {
            // the mountain's rock is pale granite, lit in coarse strokes with some dark seams
            c = mix(vec3(0.66, 0.62, 0.58), vec3(0.86, 0.8, 0.76), strokeV) * (0.9 + 0.15 * sqn);
          }
        } else if (abs(cls - 8.0) < 0.5) {
          c = mix(vec3(0.56, 0.48, 0.42), vec3(0.78, 0.7, 0.6), sqn) * (0.9 + 0.2 * strokeV);
        }
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
