// Two things the autumn wood does not have. The stones of the moss garden lie along the way in its first part, a few
// to a stone. Past the clearing's end stand the far ranges, the way src/night/far.js builds its ranges: three rings
// of mountains, each a wall of underpainting whose skyline is noise (crest), with strokes laid over the wall. None of
// it is sorted by depth. The rings are laid in a fixed order, far to near, with depth off, so they never change
// places as the eye moves. The north is the high side, since the view goes that way.
import * as THREE from 'three';
import { COMMON } from '../../oilpaint/common.js';
import { dabMaterial, dabGeometry, dabMesh } from '../../oilpaint/dabs.js';
import { way, wayDist, heightAt, noise, rng, CLEARING } from './land.js';

const STONE = /* glsl */ `
void makeDab(inout Dab d) {
  vec4 r = hash4(aData.x);
  float lit = sunAt(aPos + vec3(0.0, 0.5, 0.0));
  vec3 c = paint3(vec3(0.5, 0.5, 0.46), vec3(0.33, 0.35, 0.32), vec3(0.14, 0.17, 0.16), lit, r.x);
  // moss on the top of some of them, more where the sun falls
  float mossy = step(0.15, r.y) * (0.5 + 0.5 * step(0.3, lit));
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
  { r: 330, top: 95, seed: 3.1, col: [0.17, 0.23, 0.26], count: 2600, size: 40 },
  { r: 480, top: 160, seed: 11.7, col: [0.27, 0.36, 0.44], count: 2600, size: 55 },
  { r: 640, top: 230, seed: 23.9, col: [0.42, 0.5, 0.62], count: 2000, size: 70 },
];
const AIR = [0.25, 0.45, 0.65]; // how much of the sky's colour each ring takes, near to far
const RING_COL = /* glsl */ `const vec3 RING_COL[3] = vec3[3](${RINGS.map((o) => `vec3(${o.col.join(', ')})`).join(', ')});`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The skyline of ring k at bearing az (0 north, clockwise, as the baked horizon): the real elevation angle seen from
 * the view (src/hwadam/world/horizon.js), carried out to the ring's radius. The angle is real; the ring's distance is
 * the picture's, so the skyline's shape is the real one and its height is the real angle at that distance.
 */
function crest(k, az, horizon, eyeY) {
  const deg = (((az * 180) / Math.PI) % 360 + 360) % 360;
  const i0 = Math.floor(deg) % 360, i1 = (i0 + 1) % 360, f = deg - Math.floor(deg);
  const th = horizon[k * 360 + i0] * (1 - f) + horizon[k * 360 + i1] * f;
  return Math.max(-15, eyeY + RINGS[k].r * Math.tan(th));
}

// the stroke direction on the skyline: its tangent along the wall, tilted by the skyline's slope, pointing downhill
function slopeDir(k, az, horizon, eyeY, r) {
  const d = 0.01;
  const s = (crest(k, az + d, horizon, eyeY) - crest(k, az - d, horizon, eyeY)) / (2 * d * r);
  let v = [Math.cos(az), s, Math.sin(az)];
  if (v[1] > 0) v = v.map((c) => -c);
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((c) => c / L);
}

const RANGE = /* glsl */ `
${RING_COL}
const float RING_AIR[3] = float[3](0.25, 0.45, 0.65);
`;

export function createScenery(shared, horizon, eyeY) {
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
    const size = (rand() < 0.4 ? 0.7 : 0.3) + rand() * 0.5;
    const n = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const ox = (rand() - 0.5) * size * 0.8, oz = (rand() - 0.5) * size * 0.8;
      sp.push(x + ox, y, z + oz);
      sd.push(rand() * 1000, size * (0.7 + 0.5 * rand()), 0.06 + 0.22 * size * (j / n) + 0.05 * rand(), 0);
    }
  }

  // three stones set in front of the moss viewpoint (its camera and sight: src/hwadam/main.js's moss view)
  const mossCam = [-8, 98], mossAt = [-26, 82];
  const fl = Math.hypot(mossAt[0] - mossCam[0], mossAt[1] - mossCam[1]);
  const fwd = [(mossAt[0] - mossCam[0]) / fl, (mossAt[1] - mossCam[1]) / fl];
  for (const [dist, side, size] of [[4.5, -1.2, 0.9], [7, 1.6, 1.1], [9.5, -3.2, 0.8]]) {
    const x = mossCam[0] + fwd[0] * dist - fwd[1] * side, z = mossCam[1] + fwd[1] * dist + fwd[0] * side;
    sp.push(x, heightAt(x, z), z);
    sd.push(rand() * 1000, size, 0.42, 0); // a stone of its size, with its height set high so it reads as a body
    placed++;
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
      const az = (i / SEG) * Math.PI * 2, x = CLEARING.x + Math.sin(az) * o.r, z = CLEARING.z - Math.cos(az) * o.r;
      p.set([x, -20, z, x, crest(k, az, horizon, eyeY), z], i * 6);
      if (i < SEG) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    wall.setAttribute('position', new THREE.BufferAttribute(p, 3));
    wall.setIndex(index);
    const wallMesh = new THREE.Mesh(wall, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...shared, uCol: { value: new THREE.Vector3(...o.col) }, uAir: { value: AIR[k] } },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        out vec3 vWorld;
        void main() { vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        uniform vec3 uCol;
        uniform float uAir;
        in vec3 vWorld;
        layout(location = 0) out vec4 outC;
        void main() {
          // the top of a band is its darkest, and its foot fades into the valley haze: the reverse of a cloud
          vec3 c = uCol * mix(1.06, 0.84, smoothstep(-20.0, 90.0, vWorld.y));
          c = mix(c, uHaze, 0.5 * (1.0 - smoothstep(-20.0, 60.0, vWorld.y)));
          outC = vec4(mix(c, uHaze, uAir), 1.0);
        }`,
    }));
    wallMesh.frustumCulled = false;
    wallMesh.renderOrder = order;
    group.add(wallMesh);

    // strokes laid over the wall, each run down the skyline's slope (not level), so the wall reads as a mountain's
    // outline and not as a band of cloud. The lower part is darker and sparser, as before.
    const pos = new Float32Array(o.count * 3), dat = new Float32Array(o.count * 4), dir = new Float32Array(o.count * 3);
    for (let i = 0; i < o.count; i++) {
      const az = rand() * Math.PI * 2, top = crest(k, az, horizon, eyeY), t = Math.pow(rand(), 0.8);
      const rr = o.r - 12 - 30 * rand();
      pos.set([CLEARING.x + Math.sin(az) * rr, -20 + (top + 20) * t, CLEARING.z - Math.cos(az) * rr], i * 3);
      dat.set([rand() * 1000, o.size * (0.7 + 0.6 * rand()), t, k], i * 4);
      dir.set(slopeDir(k, az, horizon, eyeY, o.r), i * 3);
    }
    const strokes = dabMesh(dabGeometry(o.count, { aPos: [pos, 3], aDir: [dir, 3], aData: [dat, 4] }), dabMaterial(shared, {
      head: RANGE + /* glsl */ `in vec3 aPos; in vec3 aDir; in vec4 aData;`,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 r = hash4(aData.x);
          vec3 c = RING_COL[int(aData.w + 0.5)] * (0.82 + 0.36 * r.x) * mix(1.0, 0.86, aData.z);
          c = jitter(c, r.yzw, 0.16);
          c = mix(c, uHaze, RING_AIR[int(aData.w + 0.5)]);
          // the fall line: a short upright stroke down the slope, tilted and lengthened a little by its own seed
          d.dir = normalize(vec3(aDir.x * 0.5 + (r.y - 0.5) * 0.3, -1.0, aDir.z * 0.5 + (r.z - 0.5) * 0.3));
          d.pos = aPos;
          d.size = vec2(aData.y * 0.3, aData.y * (0.6 + 0.5 * r.w));
          d.c1 = c;
          d.c2 = c * 1.08;
          d.seed = aData.x;
          d.lift = 0.0;
          d.turnabout = 1.0;
        }`,
      minPx: [4, 10], maxPx: [500, 800], cells: [0, 8],
      depthTest: false, depthWrite: false,
    }), order + 0.1);
    group.add(strokes);

    // the crest: short dabs hang just under the skyline, like the tips of a wood on the ridge, so the top edge breaks up
    const sn = Math.round(o.count * 0.6);
    const cp = new Float32Array(sn * 3), cd = new Float32Array(sn * 3), cx = new Float32Array(sn * 4);
    for (let i = 0; i < sn; i++) {
      const az = rand() * Math.PI * 2, top = crest(k, az, horizon, eyeY);
      const rr = o.r - 3 - 8 * rand();
      cp.set([CLEARING.x + Math.sin(az) * rr, top - o.size * 0.1 * rand(), CLEARING.z - Math.cos(az) * rr], i * 3);
      cd.set(slopeDir(k, az, horizon, eyeY, o.r), i * 3);
      cx.set([rand() * 1000, o.size * (0.2 + 0.14 * rand()), 1, k], i * 4);
    }
    const crestMesh = dabMesh(dabGeometry(sn, { aPos: [cp, 3], aDir: [cd, 3], aData: [cx, 4] }), dabMaterial(shared, {
      head: RANGE + /* glsl */ `in vec3 aPos; in vec3 aDir; in vec4 aData;`,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 r = hash4(aData.x);
          int kk = int(aData.w + 0.5);
          vec3 c = RING_COL[kk] * vec3(0.8, 0.98, 0.9) * (0.72 + 0.4 * r.x);
          c = jitter(c, r.yzw, 0.2);
          c = mix(c, uHaze, RING_AIR[kk]);
          d.dir = aDir;
          d.pos = aPos;
          d.size = vec2(aData.y * 0.35, aData.y);
          d.c1 = c;
          d.c2 = c * 1.1;
          d.seed = aData.x;
          d.lift = 0.0;
          d.turnabout = 1.0;
        }`,
      minPx: [3, 6], maxPx: [500, 800], cells: [0, 8],
      depthTest: false, depthWrite: false,
    }), order + 0.15);
    group.add(crestMesh);
  });

  return { group, stones: placed };
}
