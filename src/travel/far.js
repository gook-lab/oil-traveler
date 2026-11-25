// The far city of the travel walk: the building outlines beyond the near square, out to about 1.3 km, stood up as plain
// masses on the mid-ground. They are not dabbed: a shader stroke over the solid, cooled and hazed with distance, so that
// the end of a street reads as a row of buildings in the air and not as a grey plate. A walker never gets there, so there
// are no colliders. Heights come from buildings.js (planBuildings), the same rules as the near square.
// At the square's edge the far blocks stand tens of metres from the walker, so within about 200 m of the eye a wall takes
// the storeys and windows of its use from the near square's FACADE table (skyline-3: the edge read as cream boxes).
import * as THREE from 'three';
import { COMMON } from '../oilpaint/common.js';
import { BRUSH_COLS, BRUSH_ROWS } from '../oilpaint/brush.js';
import { planBuildings, FACADE, GLASS } from './buildings.js';
import { verticalScale } from '../hwadam/world/land.js';

const FAR_RANGE = 1300; // the outline planning reach (m, centre within this on either axis)
/** The walls of a block with no colour of its own: the near square's city palette (buildings.js surfacesOf). */
const PAL = [[0.8, 0.78, 0.73], [0.6, 0.67, 0.72], [0.86, 0.83, 0.77], [0.5, 0.5, 0.49], [0.55, 0.42, 0.34]];
/** The kind of a face: an office's wall (storeys of windows), a tower's glass, or a roof. */
const KIND = { office: 0, tower: 1, roof: 2 };

/** The mid-ground height (m, scaled as the mid-ground is drawn) under (x, z), from the nearest node of the grid. */
function midHeight(mid, H0, x, z) {
  const { n, step, half, h } = mid;
  const i = Math.min(n - 1, Math.max(0, Math.round((x + half) / step)));
  const j = Math.min(n - 1, Math.max(0, Math.round((z + half) / step)));
  return (h[j * n + i] - H0) * verticalScale();
}

const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
const hexRGB = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s ?? ''); if (!m) return null; const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

/**
 * The facade a far block shows up close: its kind, storey, rhythm, the start of the window in each period, and its wall
 * (or a tower's low glass). A tower is glass with mullions 1.2, 1.5 or 1.8 m apart, or (a third of them) stone with
 * windows, as an office; the rest are offices, in their data colour or one of the city's.
 */
function facadeOf(p) {
  const tv = Math.floor(hash(p.c[0] * 0.21 + 4.1, p.c[1] * 0.19 - 3.3) * 6);
  if (p.use === 'tower' && tv < 4) return { kind: KIND.tower, fl: FACADE.tower.fl, per: [1.2, 1.5, 1.8][tv % 3], u1: FACADE.tower.u[1], tint: GLASS[tv % GLASS.length][0] };
  const base = hexRGB(p.colour);
  const tint = base ? base.map((x) => x * 0.78 * 0.88 + 0.5 * 0.12) : PAL[Math.floor(hash(p.c[0] + 3.1, p.c[1] - 1.7) * PAL.length)];
  return { kind: KIND.office, fl: FACADE.office.fl, per: FACADE.office.per, u1: FACADE.office.u[1], tint };
}

/**
 * Builds the far city. `outlines` are the outlines fetchFarOutlines returned; `mid` and `H0` are the mid-ground grid and
 * its zero (as createMidground takes them). Returns { group, stats }, or null when there is nothing to show.
 */
export function createFar(shared, outlines, mid, H0) {
  if (!outlines?.length || !mid) return null;
  const T0 = performance.now();
  const plans = planBuildings(outlines, [], null, { range: FAR_RANGE, landuseAt: () => 0 });
  // per vertex: shade (one tone per block); wall (m along the outline, the block's foot, kind); facade (storey, rhythm,
  // the window's start in a period); tint (the wall, or a tower's low glass)
  const pos = [], nor = [], shade = [], wall = [], fac = [], tint = [];
  let tris = 0;
  const addTri = (a, b, c, n, s, sa, sb, sc, foot, f) => {
    pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); shade.push(s, s, s);
    wall.push(sa, foot, f.kind, sb, foot, f.kind, sc, foot, f.kind);
    for (let k = 0; k < 3; k++) { fac.push(f.fl, f.per, f.u1); tint.push(...f.tint); }
    tris++;
  };
  for (const p of plans) {
    const ring = p.pts.map((q) => [q[0], q[1]]);
    if (ring.length < 3) continue;
    const base = midHeight(mid, H0, p.c[0], p.c[1]) - 1.0; // a metre under the ground, so the mass has no gap
    const top = base + 1.0 + Math.max(3, p.h);
    const s = 0.9 + 0.2 * hash(p.c[0], p.c[1]); // one tone per block, so the masses differ
    const f = facadeOf(p);
    const foot = base + 1.0;
    let along = 0; // the storeys' windows run on round the corners, as on the near square's facades
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.05) continue;
      const sign = p.ccw ? 1 : -1;
      const n = [(ez / L) * sign, 0, (-ex / L) * sign]; // the wall's outward normal
      const A = [a[0], base, a[1]], B = [b[0], base, b[1]], C = [b[0], top, b[1]], D = [a[0], top, a[1]];
      addTri(A, B, C, n, s, along, along + L, along + L, foot, f); addTri(A, C, D, n, s, along, along + L, along, foot, f);
      along += L;
    }
    const roof = THREE.ShapeUtils.triangulateShape(ring.map((q) => new THREE.Vector2(q[0], q[1])), []);
    const rf = { ...f, kind: KIND.roof };
    for (const [i0, i1, i2] of roof) {
      addTri([ring[i0][0], top, ring[i0][1]], [ring[i1][0], top, ring[i1][1]], [ring[i2][0], top, ring[i2][1]], [0, 1, 0], s * 1.08, 0, 0, 0, foot, rf);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 3));
  geometry.setAttribute('aFac', new THREE.Float32BufferAttribute(fac, 3));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
  // the far city's colour: a cool grey, paler than the near walls, so the haze lies on it as on the ranges
  const col = [0.5, 0.52, 0.56];
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON}
      in float aShade;
      in vec3 aWall;
      in vec3 aFac;
      in vec3 aTint;
      out vec3 vWorld;
      out vec3 vN;
      out float vS;
      out vec3 vWall;
      out vec3 vFac;
      out vec3 vTint;
      void main() {
        vWorld = position; vN = normal; vS = aShade; vWall = aWall; vFac = aFac; vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      in vec3 vWorld;
      in vec3 vN;
      in float vS;
      in vec3 vWall;
      in vec3 vFac;
      in vec3 vTint;
      layout(location = 0) out vec4 outC;
      // the length of [a, b) of each period P that lies between 0 and t
      float pulses(float t, float P, float a, float b) { return floor(t / P) * (b - a) + clamp(mod(t, P) - a, 0.0, b - a); }
      // the share of a pixel's footprint (w wide about t) that lies on [a, b) of each period: box-filtered, so a storey a
      // few pixels high melts into a tone instead of shimmering
      float share(float t, float w, float P, float a, float b) { w = max(w, 1e-3); return (pulses(t + 0.5 * w, P, a, b) - pulses(t - 0.5 * w, P, a, b)) / w; }
      float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      // the near walls' brush (buildings.js solidMaterial, one layer): rows 0.45 S m high of strokes about 1.7 S m long,
      // each a cell of the brush sheet; returns the tone the stroke gives the wall (its paint and its streak) and the
      // paint's relief, with the stroke's atlas uv in tuv
      vec2 stroke(vec2 uv, float S, float k, out vec2 tuv) {
        uv /= S;
        float row = floor(uv.y / 0.45);
        float L = 1.7 * (0.8 + 0.5 * h12(vec2(row, 7.1 + k)));
        float x = uv.x + h12(vec2(row, 3.3 + k)) * L;
        float id = h12(vec2(row * 1.7 + k, floor(x / L) + 0.5));
        float cell = floor(id * ${BRUSH_COLS * BRUSH_ROWS}.0 * 0.999);
        vec2 q = vec2(mix(0.06, 0.94, fract(uv.y / 0.45)), mix(0.03, 0.97, fract(x / L)));
        tuv = (vec2(mod(cell, ${BRUSH_COLS}.0), floor(cell / ${BRUSH_COLS}.0)) + q) / vec2(${BRUSH_COLS}.0, ${BRUSH_ROWS}.0);
        vec4 t = texture(tBrush, tuv);
        return vec2((1.0 + (id - 0.5) * 0.16) * mix(0.95, 1.04, t.r) * (0.97 + 0.06 * t.b), t.r * smoothstep(0.3, 0.62, t.g));
      }
      void main() {
        vec3 Nn = normalize(vN);
        vec3 toP = vWorld - cameraPosition;
        float dist = length(toP);
        // one stroke per 23 m block of the wall, stretched level, so the far city keeps a painted surface without dabs
        float s = texture(tNoise, vec2(vWorld.x + vWorld.z, vWorld.y * 0.25) / 23.0).r;
        float lit = clamp(dot(Nn, uSunDir) * 0.6 + 0.55, 0.0, 1.0);
        float light = vS * (0.82 + 0.3 * lit) * (0.92 + 0.16 * s);
        // far: the cool grey mass, with a floor band and a mullion rhythm (a few shades): the masses read as facades from afar
        float wallFace = 1.0 - abs(Nn.y);
        float band = step(0.8, fract(vWorld.y / 3.4)) * 0.16 + step(0.9, fract((vWorld.x + vWorld.z) / 3.2)) * 0.08;
        vec3 c = vec3(${col.map((v) => v.toFixed(3)).join(', ')}) * (1.0 - band * wallFace);
        // near (within about 200 m of the eye): the wall of its use, its storeys and windows as the near square's FACADE
        float near = (1.0 - smoothstep(170.0, 280.0, dist)) * step(vWall.z, 1.5);
        if (near > 0.0) {
          float y = vWorld.y - vWall.y, x = vWall.x, wy = fwidth(y), wx = fwidth(x);
          float fl = vFac.x, per = vFac.y, u1 = vFac.z;
          vec3 cn;
          if (vWall.z > 0.5) {
            // a tower: glass that takes more of the sky up its face, a spandrel band at each slab, thin mullions
            vec3 glass = mix(vTint, min(vTint + 0.24, vec3(1.0)), clamp((y - 4.0) / 60.0, 0.0, 1.0));
            cn = mix(glass, vec3(0.27, 0.32, 0.37), share(y, wy, fl, 0.0, 0.9));
            cn = mix(cn, vec3(0.2, 0.22, 0.25), share(x, wx, per, 0.0, u1));
          } else {
            // an office: a slab band, and a row of windows a storey between its column strips
            cn = mix(vTint, vTint * 0.82, share(y, wy, fl, 0.0, 0.22));
            cn = mix(cn, vec3(0.22, 0.28, 0.35), share(y, wy, fl, 1.0, 2.3) * share(x, wx, per, u1, per));
          }
          // the brush grows with the distance as on the near walls: a row of strokes is at least 28 pixels high, two
          // scales an octave apart blended so the change does not show as a seam
          float level = log2(max(1.0, 28.0 * dist * uPixel / 0.45));
          float l0 = floor(level), f = smoothstep(0.0, 1.0, level - l0);
          vec2 ta, tb;
          vec2 st = mix(stroke(vec2(x, y), exp2(l0), l0 * 3.1, ta), stroke(vec2(x, y), exp2(l0 + 1.0), l0 * 3.1 + 3.1, tb), f);
          // the light rakes across the paint's relief, as on the near walls (its change over a pixel, in atlas texels)
          float texPx = max(length(fwidth(mix(ta, tb, f) * 512.0)), 0.35);
          vec2 g = clamp(vec2(dFdx(st.y), dFdy(st.y)) * 3.0 / texPx, -0.4, 0.4);
          float rake = 0.5 * g.x - 0.7 * g.y;
          cn *= st.x * (1.0 + rake * 1.25 * uImpasto);
          cn += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * 1.2 * uImpasto;
          c = mix(c, cn, near);
        }
        c *= light;
        // the air by the distance from the eye: a far block a street away keeps its colour, and the sun's warm cast takes
        // the air only some hundreds of metres out (against the sun the near blocks read as cream boxes in a yellow haze)
        vec3 air = mix(uHaze, airColour(toP / dist), smoothstep(250.0, 900.0, dist));
        outC = vec4(mix(c, air, 0.45 * (1.0 - exp(-dist / 400.0))), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, plans, stats: { plans: plans.length, outlines: outlines.length, tris, msBuild: Math.round(performance.now() - T0) } };
}
