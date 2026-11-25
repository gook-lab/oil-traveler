// The far city of the travel walk: the building outlines beyond the near square, out to about 1.3 km, stood up as plain
// masses on the mid-ground. They are not dabbed: a shader stroke over the solid, cooled and hazed with distance, so that
// the end of a street reads as a row of buildings in the air and not as a grey plate. A walker never gets there, so there
// are no colliders. Heights come from buildings.js (planBuildings), the same rules as the near square.
import * as THREE from 'three';
import { COMMON } from '../oilpaint/common.js';
import { planBuildings } from './buildings.js';
import { verticalScale } from '../hwadam/world/land.js';

const FAR_RANGE = 1300; // the outline planning reach (m, centre within this on either axis)

/** The mid-ground height (m, scaled as the mid-ground is drawn) under (x, z), from the nearest node of the grid. */
function midHeight(mid, H0, x, z) {
  const { n, step, half, h } = mid;
  const i = Math.min(n - 1, Math.max(0, Math.round((x + half) / step)));
  const j = Math.min(n - 1, Math.max(0, Math.round((z + half) / step)));
  return (h[j * n + i] - H0) * verticalScale();
}

/**
 * Builds the far city. `outlines` are the outlines fetchFarOutlines returned; `mid` and `H0` are the mid-ground grid and
 * its zero (as createMidground takes them). Returns { group, stats }, or null when there is nothing to show.
 */
export function createFar(shared, outlines, mid, H0) {
  if (!outlines?.length || !mid) return null;
  const T0 = performance.now();
  const plans = planBuildings(outlines, [], null, { range: FAR_RANGE, landuseAt: () => 0 });
  const pos = [], nor = [], shade = [];
  let tris = 0;
  const addTri = (a, b, c, n, s) => {
    pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); shade.push(s, s, s); tris++;
  };
  for (const p of plans) {
    const ring = p.pts.map((q) => [q[0], q[1]]);
    if (ring.length < 3) continue;
    const base = midHeight(mid, H0, p.c[0], p.c[1]) - 1.0; // a metre under the ground, so the mass has no gap
    const top = base + 1.0 + Math.max(3, p.h);
    const hash = Math.sin(p.c[0] * 12.9898 + p.c[1] * 78.233) * 43758.5453;
    const s = 0.9 + 0.2 * (hash - Math.floor(hash)); // one tone per block, so the masses differ
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.05) continue;
      const sign = p.ccw ? 1 : -1;
      const n = [(ez / L) * sign, 0, (-ex / L) * sign]; // the wall's outward normal
      const A = [a[0], base, a[1]], B = [b[0], base, b[1]], C = [b[0], top, b[1]], D = [a[0], top, a[1]];
      addTri(A, B, C, n, s); addTri(A, C, D, n, s);
    }
    const roof = THREE.ShapeUtils.triangulateShape(ring.map((q) => new THREE.Vector2(q[0], q[1])), []);
    for (const [i0, i1, i2] of roof) {
      addTri([ring[i0][0], top, ring[i0][1]], [ring[i1][0], top, ring[i1][1]], [ring[i2][0], top, ring[i2][1]], [0, 1, 0], s * 1.08);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  // the far city's colour: a cool grey, paler than the near walls, so the haze lies on it as on the ranges
  const col = [0.5, 0.52, 0.56];
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON}
      in float aShade;
      out vec3 vWorld;
      out vec3 vN;
      out float vS;
      void main() { vWorld = position; vN = normal; vS = aShade; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      in vec3 vWorld;
      in vec3 vN;
      in float vS;
      layout(location = 0) out vec4 outC;
      void main() {
        // one stroke per 23 m block of the wall, stretched level, so the far city keeps a painted surface without dabs
        float s = texture(tNoise, vec2(vWorld.x + vWorld.z, vWorld.y * 0.25) / 23.0).r;
        float lit = clamp(dot(normalize(vN), uSunDir) * 0.6 + 0.55, 0.0, 1.0);
        vec3 c = vec3(${col.map((v) => v.toFixed(3)).join(', ')}) * vS * (0.82 + 0.3 * lit) * (0.92 + 0.16 * s);
        // the walls keep a floor band and a mullion rhythm (a few shades, no dabs): the masses read as facades from afar
        float wall = 1.0 - abs(normalize(vN).y);
        float band = step(0.8, fract(vWorld.y / 3.4)) * 0.16 + step(0.9, fract((vWorld.x + vWorld.z) / 3.2)) * 0.08;
        c *= 1.0 - band * wall;
        // the air takes most of the far city: the haze of the walk, with the distance
        vec3 air = airColour(normalize(vWorld - cameraPosition));
        outC = vec4(mix(c, air, clamp(0.1 + 0.3 * mistBetween(vWorld), 0.0, 0.5)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, plans, stats: { plans: plans.length, outlines: outlines.length, tris, msBuild: Math.round(performance.now() - T0) } };
}
