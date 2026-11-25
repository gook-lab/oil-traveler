// The mid-ground of the travel walk: the real ground from the edge of the baked square out to 2 km (place.mid, from
// bake.js bakeMidground), at the same vertical scale as the land (VS) so that the two meet. It is painted in large
// patches of paint over the ground's own shape, with the sun's light on the slopes, so a near hill reads as a hill
// instead of a wall. The square itself is left to the land (src/hwadam/world/land.js), which is finer.
import * as THREE from 'three';
import { COMMON, EXTENT } from '../oilpaint/common.js';
import { verticalScale } from '../hwadam/world/land.js';

// check only: ?midzone=0|1|2 keeps just one distance zone (0.5-1, 1-1.5, 1.5-2 km), to read its colour alone
const MIDZONE = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('midzone')) || '-1';

/**
 * Builds the ring-shaped mesh (a hole where the land is). `mid` is { n, step, half, h }, `H0` the zero of the scaled
 * ground (the entrance height, as land.js uses it). Returns a Mesh for the scene.
 */
/** The highest absolute height (m) of the sea in the midground: the measured sea cells of Hyeopjae sit at -1.5 to 0.5 m. */
const SEA_M = 0.5;

export function createMidground(shared, mid, H0, { urban = false } = {}) {
  const { n, step, half, h } = mid;
  const y = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) y[k] = (h[k] - H0) * verticalScale();

  // the normals, from the grid's own slopes
  const normal = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const il = Math.max(0, i - 1), ir = Math.min(n - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(n - 1, j + 1);
    const dx = (y[j * n + ir] - y[j * n + il]) / ((ir - il) * step || 1), dz = (y[ju * n + i] - y[jd * n + i]) / ((ju - jd) * step || 1);
    const len = Math.hypot(-dx, 1, -dz);
    const k = (j * n + i) * 3;
    normal[k] = -dx / len; normal[k + 1] = 1 / len; normal[k + 2] = -dz / len;
  }

  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    pos[k * 3] = -half + i * step;
    pos[k * 3 + 1] = y[k] - 0.05; // a little under the land, as the land is under its own paint
    pos[k * 3 + 2] = -half + j * step;
  }

  // triangles for each cell whose centre lies outside the land's square (the land is drawn there)
  const index = [];
  const inLand = (x, z) => Math.abs(x) < EXTENT && Math.abs(z) < EXTENT;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const cx = -half + (i + 0.5) * step, cz = -half + (j + 0.5) * step;
    if (inLand(cx, cz)) continue;
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    index.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  // the sea (T2 check 4): the cells at sea level (absolute height at most 0.5 m) are painted as water, not as the autumn ground
  const sea = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) sea[k] = h[k] <= SEA_M ? 1 : 0;
  geometry.setAttribute('sea', new THREE.BufferAttribute(sea, 1));
  geometry.setIndex(index);

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    vertexShader: /* glsl */ `
      ${COMMON}
      out vec3 vWorld;
      out vec3 vN;
      in float sea;
      out float vSea;
      void main() { vWorld = position; vN = normal; vSea = sea; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      in vec3 vWorld;
      in vec3 vN;
      in float vSea;
      layout(location = 0) out vec4 outC;
      float smoothstep2(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
      void main() {
        // large patches of paint, placed on a jittered grid, each in one of three colours of the autumn ground
        vec2 sq = floor(vWorld.xz / 16.0 + (texture(tNoise, vWorld.xz / 37.0).rg - 0.5) * 1.6) * 16.0;
        float r = texture(tNoise, sq / 41.0).r;
        vec3 moss = vec3(0.2, 0.3, 0.14), ochre = vec3(0.6, 0.44, 0.2), rust = vec3(0.5, 0.2, 0.12);
        vec3 base = r < 0.4 ? moss : r < 0.75 ? ochre : rust;
        // a town: its ground is city ground, grey-brown and grey-blue in patches, not the autumn colours
        ${urban ? 'base = mix(vec3(0.46, 0.45, 0.42), vec3(0.4, 0.43, 0.48), step(0.5, r));' : ''}
        // the sun from the slope: lit faces bright, the others deep
        float lit = clamp(dot(normalize(vN), uSunDir) * 1.4 + 0.25, 0.0, 1.0);
        vec3 c = mix(base * 0.55, base * 1.25 + vec3(0.06, 0.04, 0.0), lit);
        c *= 0.9 + 0.2 * texture(tNoise, vWorld.xz / 7.0).r;
        // the distance from the eye in three zones: the near ground keeps the autumn colour, the next goes a little deeper
        // and cooler, the farthest goes cooler and paler, so the ground reads as ground receding and not as one grey plane
        float dist = length(vWorld.xz - cameraPosition.xz);
        float zone = smoothstep(1000.0, 2000.0, dist);
        int z = dist < 1000.0 ? 0 : dist < 1500.0 ? 1 : 2;
        if (${MIDZONE.replace(/[^0-9-]/g, '') || '-1'} >= 0 && z != ${MIDZONE.replace(/[^0-9-]/g, '') || '-1'}) discard;
        // the near ground keeps its autumn colour; the far ground is a little deeper and cooler, then the haze below takes the rest
        c *= mix(1.0, 0.9, zone);
        c = mix(c, c * vec3(0.9, 0.97, 1.08), 0.6 * zone);
        // the sea cells: the water's colour, lit by the same sun; the haze below takes them the way it takes the ground
        vec3 water = mix(vec3(0.2, 0.42, 0.46), vec3(0.34, 0.58, 0.6), lit) * (0.92 + 0.16 * texture(tNoise, vWorld.xz / 9.0).r);
        c = mix(c, water, smoothstep(0.3, 0.7, vSea));
        // the air takes less of this ground than of the wood: at 1 to 2 km the full haze would make it one grey wall
        vec3 air = airColour(normalize(vWorld - cameraPosition));
        outC = vec4(mix(c, air, mix(0.12, 0.6, zone) * mistBetween(vWorld)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
