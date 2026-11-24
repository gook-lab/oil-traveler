// Two things the autumn wood does not have. The stones of the moss garden lie along the way in its first part, a few
// to a stone. Past the clearing's end stand the far ranges, the way src/night/far.js builds its ranges: three rings
// of mountains, each a wall of underpainting whose skyline is noise (crest), with strokes laid over the wall. None of
// it is sorted by depth. The rings are laid in a fixed order, far to near, with depth off, so they never change
// places as the eye moves. The north is the high side, since the view goes that way.
import * as THREE from 'three';
import { COMMON } from '../../oilpaint/common.js';
import { dabMaterial, dabGeometry, dabMesh } from '../../oilpaint/dabs.js';
import { way, wayDist, heightAt, noise, rng } from './land.js';

const STONE = /* glsl */ `
void makeDab(inout Dab d) {
  vec4 r = hash4(aData.x);
  float lit = sunAt(aPos + vec3(0.0, 0.5, 0.0));
  vec3 c = paint3(vec3(0.5, 0.5, 0.46), vec3(0.33, 0.35, 0.32), vec3(0.14, 0.17, 0.16), lit, r.x);
  // moss on the top of some of them, more where the sun falls
  float mossy = step(0.55, r.y) * (0.5 + 0.5 * step(0.3, lit));
  c = mix(c, vec3(0.4, 0.52, 0.2) * (0.6 + 0.6 * lit), mossy * 0.8);
  c = jitter(c, r.zxy, 0.5);
  float a = r.w * TAU;
  d.pos = aPos;
  d.dir = vec3(cos(a), 0.0, sin(a));
  d.size = vec2(aData.y, aData.y * 0.6);
  d.lie = 1.0;
  d.nrm = vec3(0.0, 1.0, 0.0);
  d.height = aData.z;
  d.c1 = hazed(c, aPos);
  d.c2 = hazed(c * 1.12, aPos);
  d.seed = aData.x;
  d.lift = 0.0;
  d.turnabout = 1.0;
}
`;

// the rings: r = radius of the wall (m), top = how high its skyline stands in the north (m), col = its colour
const RINGS = [
  { r: 330, top: 62, seed: 3.1, col: [0.2, 0.24, 0.38], count: 2600, size: 16 },
  { r: 480, top: 105, seed: 11.7, col: [0.34, 0.38, 0.52], count: 2600, size: 24 },
  { r: 640, top: 150, seed: 23.9, col: [0.5, 0.54, 0.64], count: 2000, size: 32 },
];
const RING_COL = /* glsl */ `const vec3 RING_COL[3] = vec3[3](${RINGS.map((o) => `vec3(${o.col.join(', ')})`).join(', ')});`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How high ring k stands at bearing az (0 north, + east): noise along the ring, and lower away from the north. */
function crest(k, az) {
  const o = RINGS[k], c = Math.cos(az), s = Math.sin(az);
  const n = 0.45 + 0.55 * noise(c * 2.2 + o.seed, s * 2.2) + 0.28 * noise(c * 6.5, s * 6.5 + o.seed) + 0.12 * noise(c * 17 + o.seed, s * 17);
  const north = 0.3 + 0.7 * sstep(-0.2, 0.9, c);
  return o.top * north * Math.min(1.4, Math.max(0.1, n));
}

const RANGE = /* glsl */ `
${RING_COL}
`;

export function createScenery(shared) {
  const rand = rng(8831);

  // --- stones: pos 3, data 4 (seed, size, height, unused) ---
  const sp = [], sd = [];
  let placed = 0;
  for (let tries = 0; placed < 150 && tries < 8000; tries++) {
    const k = Math.floor(rand() * 52); // the first part of the way: about the first 27 per cent of its samples
    const [wx, wz] = way[k];
    const [nx, nz] = way[Math.min(k + 1, way.length - 1)];
    const dx = nx - wx, dz = nz - wz, len = Math.hypot(dx, dz) || 1;
    const side = rand() < 0.5 ? -1 : 1, off = (2.6 + rand() * 6.5) * side;
    const x = wx + (-dz / len) * off, z = wz + (dx / len) * off;
    if (wayDist(x, z) < 2.2) continue;
    placed++;
    const y = heightAt(x, z);
    const size = 0.3 + rand() * 0.45;
    const n = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const ox = (rand() - 0.5) * size * 0.8, oz = (rand() - 0.5) * size * 0.8;
      sp.push(x + ox, y, z + oz);
      sd.push(rand() * 1000, size * (0.7 + 0.5 * rand()), 0.06 + 0.22 * size * (j / n) + 0.05 * rand(), 0);
    }
  }

  const group = new THREE.Group();
  const stoneMesh = dabMesh(dabGeometry(sd.length / 4, { aPos: [new Float32Array(sp), 3], aData: [new Float32Array(sd), 4] }), dabMaterial(shared, {
    head: /* glsl */ `in vec3 aPos; in vec4 aData;`,
    body: STONE,
    minPx: [3, 6], maxPx: [300, 420], cells: [0, 4],
  }), 5);
  group.add(stoneMesh);

  // --- the ranges: far ring first. Each is a wall from -20 up to its skyline, with strokes over it ---
  const SEG = 360;
  RINGS.forEach((o, k) => {
    const order = -8.8 + 0.2 * (RINGS.length - 1 - k); // far before near, behind the trees (order 3 and up)
    const wall = new THREE.BufferGeometry();
    const p = new Float32Array((SEG + 1) * 2 * 3), index = [];
    for (let i = 0; i <= SEG; i++) {
      const az = (i / SEG) * Math.PI * 2, x = Math.sin(az) * o.r, z = -Math.cos(az) * o.r;
      p.set([x, -20, z, x, crest(k, az), z], i * 6);
      if (i < SEG) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    wall.setAttribute('position', new THREE.BufferAttribute(p, 3));
    wall.setIndex(index);
    const wallMesh = new THREE.Mesh(wall, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...shared, uCol: { value: new THREE.Vector3(...o.col) } },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        out vec3 vWorld;
        void main() { vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        uniform vec3 uCol;
        in vec3 vWorld;
        layout(location = 0) out vec4 outC;
        void main() { outC = vec4(hazed(uCol * mix(0.78, 1.12, smoothstep(-20.0, 90.0, vWorld.y)), vWorld), 1.0); }`,
    }));
    wallMesh.frustumCulled = false;
    wallMesh.renderOrder = order;
    group.add(wallMesh);

    // strokes laid over the wall: the lower part is darker and sparser, the skyline is painted over the wall's top
    const pos = new Float32Array(o.count * 3), dat = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count; i++) {
      const az = rand() * Math.PI * 2, top = crest(k, az), t = Math.pow(rand(), 0.8);
      const rr = o.r - 12 - 30 * rand();
      pos.set([Math.sin(az) * rr, -20 + (top + 20) * t, -Math.cos(az) * rr], i * 3);
      dat.set([rand() * 1000, o.size * (0.7 + 0.6 * rand()), t, k], i * 4);
    }
    const strokes = dabMesh(dabGeometry(o.count, { aPos: [pos, 3], aData: [dat, 4] }), dabMaterial(shared, {
      head: RANGE + /* glsl */ `in vec3 aPos; in vec4 aData;`,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 r = hash4(aData.x);
          vec3 c = RING_COL[int(aData.w + 0.5)] * (0.82 + 0.36 * r.x) * mix(0.8, 1.15, aData.z);
          c = jitter(c, r.yzw, 0.16);
          // strokes run along the skyline
          d.dir = normalize(vec3(-aPos.z, 0.0, aPos.x));
          d.pos = aPos;
          d.size = vec2(aData.y, aData.y * 0.5);
          d.c1 = hazed(c, aPos);
          d.c2 = hazed(c * 1.08, aPos);
          d.seed = aData.x;
          d.lift = 0.0;
          d.turnabout = 1.0;
        }`,
      minPx: [4, 10], maxPx: [500, 800], cells: [0, 8],
      depthTest: false, depthWrite: false,
    }), order + 0.1);
    group.add(strokes);
  });

  return { group, stones: placed };
}
