// The forest floor of the hwadam walk: the carpet and the undergrowth of the autumn wood (src/world/floor.js), with
// the litter and the clumps taking their colour from the part of the walk they lie in (segW, read from the land map).
// Every dab belongs to one small square of ground for good; what changes with distance is only which are drawn.
import * as THREE from 'three';
import { groundRings } from '../../oilpaint/ground.js';
import { segW, SEG_GLSL } from './segments.js';

// leaf litter by kind: 0 moss-green, 1 crimson, 2 vermilion, 3 birch yellow, 4 the bare way, 5 gold grass gone down
export const LITTER = /* glsl */ `
// the two ridge views' fans: 25 degrees either side of the sight, 30 m out; there the grass is cut short
const vec2 FAN_A[2] = vec2[2](vec2(-192.0, -190.0), vec2(-192.0, -175.0));
const vec2 FAN_D[2] = vec2[2](vec2(0.927, 0.375), vec2(0.602, 0.799));
float inFan(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 d = p - FAN_A[i];
    float r = length(d);
    if (r > 0.01 && r < 30.0 && dot(d / r, FAN_D[i]) > 0.9063) f = 1.0;
  }
  return f;
}
const vec3 LIT_L[6] = vec3[6](vec3(0.36, 0.44, 0.24), vec3(0.8, 0.16, 0.16), vec3(0.96, 0.44, 0.14), vec3(0.96, 0.84, 0.42), vec3(0.74, 0.58, 0.42), vec3(0.97, 0.8, 0.36));
const vec3 LIT_M[6] = vec3[6](vec3(0.24, 0.31, 0.18), vec3(0.52, 0.1, 0.1), vec3(0.72, 0.24, 0.09), vec3(0.76, 0.6, 0.26), vec3(0.5, 0.38, 0.3), vec3(0.74, 0.52, 0.2));
const vec3 LIT_S[6] = vec3[6](vec3(0.14, 0.18, 0.14), vec3(0.3, 0.06, 0.09), vec3(0.4, 0.1, 0.1), vec3(0.42, 0.36, 0.2), vec3(0.27, 0.22, 0.27), vec3(0.4, 0.26, 0.13));
// which kind lies here: the part of the walk decides the chance of each, and v varies it over the ground
int pickKind(float pick, vec4 sw, float v) {
  if (pick < sw.x) return 0;
  if (pick < sw.x + sw.y) return v < 0.33 ? 1 : v < 0.66 ? 2 : 3;
  if (pick < sw.x + sw.y + sw.z) return 3;
  return 5;
}
vec3 litter(int k, float lit, float r) { return paint3(LIT_L[k], LIT_M[k], LIT_S[k], lit, r); }
`;

const carpet = /* glsl */ `
void makeDab(inout Dab d) {
  vec2 cell; float sub;
  if (!ringCell(0.0, true, cell, sub)) { d.alive = 0.0; return; }
  vec4 r = hash4(cell, sub * 3.0 + 1.0);
  vec4 q = hash4(cell + 31.7, sub + 11.0);
  vec2 xz = (cell + r.xy) * uCell0;
  float lod;
  d.alive = ringGrow(distance(xz, cameraPosition.xz), lod);
  if (d.alive <= 0.0) return;
  vec3 P = vec3(xz.x, heightAt(xz), xz.y);
  vec3 Nn = normalAt(xz);
  vec4 m = texture(tLand, landUv(xz));
  vec4 sw = segW(m.a);
  float lit = woodSunAt(P + vec3(0.0, 0.2, 0.0)) * clamp(dot(Nn, uSunDir) * 2.4, 0.0, 1.0);
  float patch_ = texture(tNoise, xz / 13.0).r * 1.9 + texture(tNoise, xz / 3.7).g * 0.5;
  // the bare way is its own colour; elsewhere the kind is drawn by the part of the walk
  float v = fract(patch_ + (q.z - 0.5) * 0.3);
  int k1 = q.x < m.r * 0.62 ? 4 : pickKind(q.y, sw, v);
  vec3 c1 = litter(k1, lit, q.y);
  int k2 = q.z < m.r * 0.31 ? 4 : pickKind(q.w, sw, fract(v + 0.2));
  vec3 c2 = litter(k2, lit, q.w);
  // the open ground of the clearing is grass gone to gold
  vec3 gl = paint3(vec3(0.95, 0.8, 0.36), vec3(0.62, 0.52, 0.2), vec3(0.2, 0.2, 0.2), lit, q.y);
  float grassy = step(r.z, m.g * 0.8);
  c1 = mix(c1, gl, grassy);
  // here and there a wet leaf in the shade gives back the sky
  if (lit < 0.2 && q.w > 0.93) c1 = mix(vec3(0.34, 0.36, 0.52), vec3(0.2, 0.17, 0.26), q.z);
  // round mounds of moss in the garden, 1 to 2 m across
  float hump = smoothstep(0.42, 0.7, texture(tNoise, xz / 1.4).r);
  // the moss garden carries no leaves: its carpet is moss, dark green in the hollows to light green on the crowns
  vec3 mossC = mix(vec3(0.14, 0.26, 0.1), vec3(0.5, 0.74, 0.26), max(hump, q.w * 0.6)) * (0.55 + 0.6 * lit);
  c1 = mix(c1, mossC, sw.x);
  c2 = mix(c2, mossC * 0.92, sw.x);
  c1 = jitter(c1, r.wzy, 0.5);
  c2 = jitter(c2, q.wzy, 0.5);
  // leaves lie any way round, though those that fell together lie much alike
  float a = (texture(tNoise, xz / 6.3).a * 1.2 + q.y * 0.8) * TAU;
  d.dir = vec3(cos(a), 0.0, sin(a));
  d.pos = P;
  // the garden's litter is short, round touches (moss); elsewhere the leaves are long
  float shrink = mix(1.0, 0.7, sw.y);
  // the moss touches are as wide as they are long: round, not blades
  float wide = (1.05 + 0.5 * r.z) * mix(1.0, 0.6, sw.x);
  d.size = uCell0 * vec2(wide, mix(mix(1.7 + 0.9 * r.w, 1.05 + 0.4 * r.w, sw.x) * shrink, wide, sw.x)) * lod;
  d.c1 = hazed(c1, P);
  d.c2 = hazed(c2, P);
  d.seed = dot(cell, vec2(1.0, 57.0)) + sub * 0.37;
  d.turnabout = 1.0;
  d.lie = 1.0;
  d.nrm = Nn;
  // in the moss garden the cushions rise into hummocks: some tufts stand up to 0.12 m higher
  // round mounds of moss in the garden, 1 to 2 m across: the crown of each is bright green, its hollow dark
  c1 = mix(c1, mix(vec3(0.2, 0.3, 0.1), vec3(0.62, 0.78, 0.26), hump), sw.x * 0.85);
  d.height = ((0.03 + 0.07 * q.z) + sw.x * (0.12 * q.w + 0.45 * hump)) * pow(lod, 0.35);
  d.glaze = 1.0;
}
`;

// undergrowth: clumps of bracken, fern and grass. Each frond or blade is one flick of the brush, and the flicks of
// a clump fan out from its foot. The colour of a clump is the mix of the parts of the walk: green in the garden,
// rust on the climb, yellow among the birches, gold on the rise.
const growth = /* glsl */ `
void makeDab(inout Dab d) {
  vec2 cell; float sub;
  if (!ringCell(40.0, false, cell, sub)) { d.alive = 0.0; return; }
  vec4 r = hash4(cell, 40.0);
  vec4 q = hash4(cell + 17.3, 51.0);
  vec4 f = hash4(cell + sub * 7.7 + 3.1, sub * 13.0 + 3.0);
  vec2 foot = (cell + r.xy) * uCell0;
  float lod;
  d.alive = ringGrow(distance(foot, cameraPosition.xz), lod);
  if (d.alive <= 0.0) return;
  vec4 m = texture(tLand, landUv(foot));
  vec4 sw = segW(m.a);
  // it grows in drifts, keeps off the way, and fills the clearing
  float drift = smoothstep(0.46, 0.7, texture(tNoise, foot / 37.0).a);
  float chance = max(0.05 + 0.8 * drift, m.g) * (1.0 - m.r) * (1.0 - 0.8 * sw.x);
  if (q.x > chance) { d.alive = 0.0; return; }
  float grass = step(q.z, max(m.g * 1.1, 0.22)) * (1.0 - sw.x); // a tuft of grass rather than a fern; none in the moss garden
  float big = min(pow(lod, 0.6), 2.2);
  float a = (sub + f.x) / 6.0 * TAU + r.z * TAU;
  vec2 fan = vec2(cos(a), sin(a));
  vec2 xz = foot + fan * mix(0.1, 0.03, grass) * big;
  vec3 P = vec3(xz.x, heightAt(xz), xz.y);
  float gust = gustAt(xz);
  float lit = sunAt(P + vec3(0.0, 0.3, 0.0));
  vec3 L = sw.x * vec3(0.34, 0.42, 0.22) + sw.y * vec3(0.9, 0.24, 0.12) + sw.z * vec3(1.0, 0.82, 0.26) + sw.w * vec3(0.98, 0.56, 0.16);
  vec3 M = sw.x * vec3(0.22, 0.3, 0.14) + sw.y * vec3(0.62, 0.12, 0.1) + sw.z * vec3(0.72, 0.54, 0.15) + sw.w * vec3(0.68, 0.36, 0.13);
  vec3 S = sw.x * vec3(0.13, 0.23, 0.17) + sw.y * vec3(0.34, 0.09, 0.12) + sw.z * vec3(0.34, 0.26, 0.16) + sw.w * vec3(0.34, 0.18, 0.16);
  vec3 c = paint3(L, M, S, lit, f.w);
  if (grass > 0.5) {
    float gg = sw.x;
    c = paint3(gg * vec3(0.36, 0.46, 0.24) + (1.0 - gg) * vec3(1.0, 0.88, 0.46), gg * vec3(0.22, 0.3, 0.14) + (1.0 - gg) * vec3(0.76, 0.6, 0.24), gg * vec3(0.16, 0.26, 0.16) + (1.0 - gg) * vec3(0.3, 0.27, 0.2), lit, f.w);
  }
  c = jitter(c, f.zwx, 0.55);
  float sway = sin(uTime * (1.6 + f.z) + f.w * 40.0) * (0.04 + 0.1 * gust);
  vec2 lean = fan * mix(0.9 + 1.3 * f.y, 0.12 + 0.4 * f.y, grass) + uWind.xy * (0.08 + 0.6 * gust + sway);
  d.dir = normalize(vec3(lean.x, 1.0, lean.y));
  d.pos = P - vec3(0.0, 0.02, 0.0);
  float tall = mix(0.45, 0.85, f.z) * mix(1.0, 1.3, m.g) * mix(0.72, 1.0, grass) * mix(1.0, 0.4, sw.x) * mix(1.0, 0.55, sw.y) * mix(1.0, 0.25, inFan(foot));
  // a frond is a broad curved stroke that arches over; a blade of grass a thin straight one
  d.size = vec2(mix(0.17, 0.04, grass) * big * (0.8 + 0.5 * f.x), tall);
  d.cell = grass > 0.5 ? floor(f.y * 2.99) : (f.x > 0.5 ? 3.0 : 7.0);
  d.c1 = hazed(c, P);
  d.c2 = hazed(jitter(c * 1.2, f.xzy, 0.8), P);
  d.seed = dot(cell, vec2(1.0, 57.0)) + sub * 0.37 + 0.5;
  d.base = 1.0;
  d.lift = 0.25;
}
`;

export function createFloor(shared) {
  const carpetRings = groundRings(shared, { head: LITTER + SEG_GLSL, body: carpet, per: 3, n: 192, cell0: 0.14, levels: 6, minPx: [5, 9], maxPx: [4000, 4000], cells: [0, 8] });
  const growthRings = groundRings(shared, { head: LITTER + SEG_GLSL, body: growth, per: 6, n: 96, cell0: 0.42, levels: 4, minPx: [2.5, 12], maxPx: [60, 420], cells: [0, 4] });
  const group = new THREE.Group();
  group.add(carpetRings.group, growthRings.group);
  return { group, follow(x, z) { carpetRings.follow(x, z); growthRings.follow(x, z); } };
}
