// Two things the autumn wood does not have. The stones of the moss garden lie along the way in its first part, a few
// to a stone, flat dabs stacked a little. A far ridge stands past the clearing's end, seen between the last trunks,
// painted only in the mist's colour and a little of its own.
import * as THREE from 'three';
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

const RIDGE = /* glsl */ `
void makeDab(inout Dab d) {
  vec4 r = hash4(aData.x);
  // the lower slopes are darker; the crest, higher up, is paler and catches the light
  vec3 c = mix(vec3(0.3, 0.36, 0.42), vec3(0.2, 0.26, 0.3), r.x) * (0.8 + 0.4 * r.y);
  c = mix(c, vec3(0.6, 0.6, 0.55), 0.35 * r.z * aData.z);
  d.pos = aPos;
  d.dir = normalize(vec3(1.0, (r.x - 0.5) * 0.2, 0.0));
  d.size = vec2(aData.y, aData.y * 0.5);
  d.c1 = mix(c, hazed(c, aPos), 0.5);
  d.c2 = mix(c * 1.1, hazed(c * 1.1, aPos), 0.5);
  d.seed = aData.x;
  d.lift = 0.0;
}
`;

export function createScenery(shared) {
  const rand = rng(8831);

  // --- stones: pos 3, data 4 (seed, size, height, unused) ---
  const sp = [], sd = [];
  let placed = 0;
  for (let tries = 0; placed < 90 && tries < 4000; tries++) {
    const k = Math.floor(rand() * 52); // the first part of the way: about the first 27 per cent of its samples
    const [wx, wz] = way[k];
    const [nx, nz] = way[Math.min(k + 1, way.length - 1)];
    const dx = nx - wx, dz = nz - wz, len = Math.hypot(dx, dz) || 1;
    const side = rand() < 0.5 ? -1 : 1, off = (2.6 + rand() * 6.5) * side;
    const x = wx + (-dz / len) * off, z = wz + (dx / len) * off;
    if (wayDist(x, z) < 2.2) continue;
    placed++;
    const y = heightAt(x, z);
    const size = 0.25 + rand() * 0.3;
    const n = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const ox = (rand() - 0.5) * size * 0.8, oz = (rand() - 0.5) * size * 0.8;
      sp.push(x + ox, y, z + oz);
      sd.push(rand() * 1000, size * (0.7 + 0.5 * rand()), 0.06 + 0.22 * size * (j / n) + 0.05 * rand(), 0);
    }
  }

  // --- the far ridge: pos 3, data 4 (seed, size, how high up the ridge, unused) ---
  // two layers: the near ridge, and a paler one behind it, both past the last trunks of the wood
  const rp = [], rd = [];
  for (const [zBase, zSpan, height, count, size] of [[-430, 60, 110, 1100, 26], [-640, 80, 170, 700, 40]]) {
    for (let i = 0; i < count; i++) {
      const x = -520 + 1040 * rand();
      const z = zBase - zSpan * rand();
      const top = height + height * 0.4 * noise(x / 200, 4.1) + height * 0.15 * noise(x / 60, 8.3);
      const y = 4 + (top - 4) * (0.25 + 0.75 * rand());
      rp.push(x, y, z);
      rd.push(rand() * 1000, size * (0.6 + 0.8 * rand()), (y - 4) / (top - 4 + 1e-3), 0);
    }
  }

  const stoneMesh = dabMesh(dabGeometry(sd.length / 4, { aPos: [new Float32Array(sp), 3], aData: [new Float32Array(sd), 4] }), dabMaterial(shared, {
    head: /* glsl */ `in vec3 aPos; in vec4 aData;`,
    body: STONE,
    minPx: [3, 6], maxPx: [300, 420], cells: [0, 4],
  }), 5);
  const ridgeMesh = dabMesh(dabGeometry(rd.length / 4, { aPos: [new Float32Array(rp), 3], aData: [new Float32Array(rd), 4] }), dabMaterial(shared, {
    head: /* glsl */ `in vec3 aPos; in vec4 aData;`,
    body: RIDGE,
    minPx: [4, 10], maxPx: [500, 800], cells: [0, 8],
  }), -8);

  const group = new THREE.Group();
  group.add(ridgeMesh, stoneMesh);
  return { group, stones: placed };
}
