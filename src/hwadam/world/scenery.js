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
  // lighter than the green floor by 15 L* or more, so the stones read against the moss (measured on the moss shot,
  // stone L* about 49 in shade, 60 mid, 80 lit against the floor's 24 to 46); the value is lifted, the hue is kept
  vec3 c = paint3(vec3(0.82, 0.82, 0.76), vec3(0.6, 0.62, 0.57), vec3(0.46, 0.48, 0.46), lit, r.x);
  // the shade side is a cool dark grey-teal, so the stone reads as a lump, not a white slab
  c = mix(c, vec3(0.2, 0.26, 0.26), (1.0 - smoothstep(0.1, 0.45, lit)) * 0.7);
  // moss on the top of some of them, more where the sun falls
  float mossy = step(0.15, r.y) * (0.5 + 0.5 * step(0.3, lit));
  c = mix(c, vec3(0.4, 0.52, 0.2) * (0.6 + 0.6 * lit), mossy * 0.8);
  // the cap stroke is moss on top of the stone, so the stone reads as a rounded lump under the moss
  c = mix(c, vec3(0.36, 0.5, 0.18) * (0.6 + 0.6 * lit), aData.w * 0.9);
  c = jitter(c, r.zxy, 0.5);
  float a = r.w * TAU;
  d.pos = aPos;
  d.dir = vec3(cos(a), 0.0, sin(a));
  // a round lump: the stone's two sides are its own size (the 0.6 ratio stood it up as a thin sliver, seen edge-on)
  d.size = vec2(aData.y, aData.y * 0.9);
  d.lie = 0.0;
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
// five ranges, near to far; the baked horizon has three bands, so two ranges share a band at a different radius
// (band: which horizon band gives the skyline). Each farther range is lighter and less saturated than the one before.
const RINGS = [
  { r: 330, band: 0, col: [0.24, 0.3, 0.33], count: 3000, size: 40 },
  { r: 410, band: 0, col: [0.29, 0.35, 0.39], count: 1400, size: 46 },
  { r: 480, band: 1, col: [0.34, 0.4, 0.45], count: 1000, size: 52 },
  { r: 560, band: 1, col: [0.4, 0.45, 0.5], count: 700, size: 60 },
  { r: 640, band: 2, col: [0.46, 0.5, 0.55], count: 500, size: 68 },
];
const AIR = [0.22, 0.32, 0.42, 0.5, 0.58]; // how much of the sky's colour each ring takes, near to far
const RING_COL = /* glsl */ `const vec3 RING_COL[5] = vec3[5](${RINGS.map((o) => `vec3(${o.col.join(', ')})`).join(', ')});`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The skyline of ring k at bearing az (0 north, clockwise, as the baked horizon): the real elevation angle seen from
 * the view (src/hwadam/world/horizon.js), carried out to the ring's radius. The angle is real; the ring's distance is
 * the picture's, so the skyline's shape is the real one and its height is the real angle at that distance.
 */
function crest(k, az, horizon, eyeY) {
  const deg = (((az * 180) / Math.PI) % 360 + 360) % 360;
  // the horizon samples come one per degree and carry the terrain's spikes (the sawtooth and thorns on the ring
  // skyline), so the skyline is a triangle-weighted mean over three degrees either side
  const sample = (d) => {
    const i0 = Math.floor(d) % 360, i1 = (i0 + 1) % 360, f = d - Math.floor(d);
    return horizon[RINGS[k].band * 360 + i0] * (1 - f) + horizon[RINGS[k].band * 360 + i1] * f;
  };
  let th = 0, wsum = 0;
  for (let j = -3; j <= 3; j++) {
    const w = 4 - Math.abs(j);
    th += w * sample((deg + j + 360) % 360);
    wsum += w;
  }
  th /= wsum;
  // the middle ranges (330 to 650 m) fall back in the two sight bearings of the view (112 and 143 degrees): the sight
  // opens to the far ridge there, and the wood between does not hide it
  if (Math.min(Math.abs(deg - 112), Math.abs(deg - 143)) < 22 && RINGS[k].r < 650) th *= 0.4;
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
// air perspective per ring: the farther ring fades toward the sky, but keeps a step darker than it (0.65 made it vanish)
const float RING_AIR[5] = float[5](0.22, 0.32, 0.42, 0.5, 0.58);
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
  for (const [dist, side, size] of [[4.5, -1.2, 0.9], [7, 1.6, 1.1], [9.5, -3.2, 0.8], [5.8, 0.5, 0.7], [12.5, -1.0, 1.2], [3.2, 0.3, 0.9], [8.5, -0.6, 1.4], [14.5, 2.2, 1.5]]) {
    const x = mossCam[0] + fwd[0] * dist - fwd[1] * side, z = mossCam[1] + fwd[1] * dist + fwd[0] * side;
    // one brush mark shows only a sliver of its card, so each stone is a cluster of marks like the rest of the garden's stones
    // six marks per stone: the lower ones stone-grey, the top one (flag 1 in data.w) the moss cap
    for (let j = 0; j < 6; j++) {
      const ox = (rand() - 0.5) * size * 0.6, oz = (rand() - 0.5) * size * 0.6;
      const cap = j === 5 ? 1 : 0;
      // the grey marks sink a little into the moss (a stone lies in the ground, it does not sit on it)
      sp.push(x + ox, heightAt(x, z) + (cap ? 0.12 : -0.08 * size), z + oz);
      // the grey marks are wider than the cap, so the stone keeps its grey rim under the moss
      sd.push(rand() * 1000, cap ? size * 0.7 : size * (1.1 + 0.4 * rand()), cap ? 0.62 : 0.3 + 0.15 * j / 5, cap);
    }
    placed++;
  }

  const group = new THREE.Group();
  const stoneMesh = dabMesh(dabGeometry(sd.length / 4, { aPos: [new Float32Array(sp), 3], aData: [new Float32Array(sd), 4] }), dabMaterial(shared, {
    head: /* glsl */ `in vec3 aPos; in vec4 aData;`,
    body: STONE,
    minPx: [3, 6], maxPx: [300, 420], cells: [0, 4],
  }), 5);
  group.add(stoneMesh);

  // --- the sun gaps: where the canopy opens on the sun, the sky shows as a flat cream patch. A few hundred pale leaves
  // hang in the sky round the sun's direction, far beyond the trees, so the gap has touches in it (no shared sky changed)
  const sun = shared.uSunDir.value;
  const gp = [], gd = [];
  for (let i = 0; i < 320; i++) {
    const v = [sun.x + (rand() - 0.5) * 0.7, sun.y + (rand() - 0.5) * 0.5, sun.z + (rand() - 0.5) * 0.7];
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    if (v[1] / L < 0.02) continue;
    gp.push(v[0] / L, v[1] / L, v[2] / L);
    gd.push(rand() * 1000, 0.6 + 0.8 * rand(), rand(), rand());
  }
  const sunMesh = dabMesh(dabGeometry(gd.length / 4, { aPos: [new Float32Array(gp), 3], aData: [new Float32Array(gd), 4] }), dabMaterial(shared, {
    head: /* glsl */ `in vec3 aPos; in vec4 aData;`,
    body: /* glsl */ `
void makeDab(inout Dab d) {
  vec4 r = hash4(aData.x);
  vec3 v = normalize(aPos);
  vec3 c = paint3(vec3(0.98, 0.92, 0.62), vec3(0.94, 0.78, 0.4), vec3(0.62, 0.44, 0.22), 1.0, r.x);
  c = mix(c, vec3(0.92, 0.56, 0.24), step(0.6, r.y) * 0.7);
  d.pos = cameraPosition + v * 420.0;
  d.dir = vec3(cos(r.z * TAU), 0.0, sin(r.z * TAU));
  d.size = vec2(16.0 + 22.0 * aData.y, 7.0 + 8.0 * aData.y);
  d.lie = 0.0;
  d.nrm = vec3(0.0, 1.0, 0.0);
  d.height = 0.0;
  d.lift = 0.0;
  d.c1 = hazed(c, d.pos);
  d.c2 = hazed(c * 1.1, d.pos);
  d.seed = aData.x;
  d.turnabout = 0.0;
}
`,
    minPx: [2, 4], maxPx: [40, 60], cells: [0, 4],
  }), 2);
  group.add(sunMesh);

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
          // the wall is broken by noise along its length, so it does not read as one even slab
          c *= 0.9 + 0.2 * texture(tNoise, vec2(atan(vWorld.z, vWorld.x) * 3.0, vWorld.y / 60.0)).r;
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
          // nearly the underpainting's own colour; the farther the ring, the less the brush shows against it
          float amp = mix(1.0, 0.45, aData.w / 2.0);
          vec3 c = RING_COL[int(aData.w + 0.5)] * (1.0 + amp * (r.x - 0.5) * 0.14);
          c = jitter(c, r.yzw, 0.03 * amp);
          c = mix(c, uHaze, RING_AIR[int(aData.w + 0.5)]);
          // the skyline's own direction: a level touch along the crest (tilted a little by the slope), not an upright
          // one (the upright touches read as vertical plates standing on the sky)
          d.dir = normalize(vec3(aDir.x + (r.y - 0.5) * 0.2, aDir.y * 0.6, aDir.z + (r.z - 0.5) * 0.2));
          d.pos = aPos;
          d.size = vec2(aData.y * 0.2, aData.y * (0.6 + 0.4 * r.w));
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

  });

  return { group, stones: placed, stonePos: sp, stoneData: sd };
}
