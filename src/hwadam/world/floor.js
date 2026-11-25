// The forest floor of the hwadam walk: the carpet and the undergrowth of the autumn wood (src/world/floor.js), with
// the litter and the clumps taking their colour from the part of the walk they lie in (segW, read from the land map).
// Every dab belongs to one small square of ground for good; what changes with distance is only which are drawn.
import * as THREE from 'three';
import { groundRings } from '../../oilpaint/ground.js';
import { segW, SEG_GLSL } from './segments.js';
import { COVER_GLSL } from './cover.js';

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
const vec3 LIT_L[6] = vec3[6](vec3(0.36, 0.44, 0.24), vec3(0.8, 0.16, 0.16), vec3(0.96, 0.44, 0.14), vec3(0.96, 0.84, 0.42), vec3(0.86, 0.76, 0.58), vec3(0.97, 0.8, 0.36));
const vec3 LIT_M[6] = vec3[6](vec3(0.24, 0.31, 0.18), vec3(0.52, 0.1, 0.1), vec3(0.72, 0.24, 0.09), vec3(0.76, 0.6, 0.26), vec3(0.68, 0.58, 0.44), vec3(0.74, 0.52, 0.2));
const vec3 LIT_S[6] = vec3[6](vec3(0.14, 0.18, 0.14), vec3(0.3, 0.06, 0.09), vec3(0.4, 0.1, 0.1), vec3(0.42, 0.36, 0.2), vec3(0.44, 0.38, 0.32), vec3(0.4, 0.26, 0.13));
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
  // no litter on sea, sand, rock or built-up ground (T2): the ground's own paint shows there
  if (bareCover(coverClass(xz)) || wetCover(xz)) { d.alive = 0.0; return; }
  vec3 P = vec3(xz.x, heightAt(xz), xz.y);
  vec3 Nn = normalAt(xz);
  vec4 m = texture(tLand, landUv(xz));
  vec4 sw = segW(m.a);
  float lit = woodSunAt(P + vec3(0.0, 0.2, 0.0)) * clamp(dot(Nn, uSunDir) * 2.4, 0.0, 1.0);
  float patch_ = texture(tNoise, xz / 13.0).r * 1.9 + texture(tNoise, xz / 3.7).g * 0.5;
  // the bare way is its own colour; elsewhere the kind is drawn by the part of the walk
  float v = fract(patch_ + (q.z - 0.5) * 0.3);
  int k1 = q.x < m.r * 0.9 ? 4 : pickKind(q.y, sw, v);
  vec3 c1 = litter(k1, lit, q.y);
  int k2 = q.z < m.r * 0.6 ? 4 : pickKind(q.w, sw, fract(v + 0.2));
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
  // the sun on the moss stays as it is; only the shade goes cool and damp, a blue-green
  // the value steps are small, so the garden reads as one velvet cover, not as leaves on dark ground
  vec3 mossC = mix(vec3(0.1, 0.2, 0.17), vec3(0.38, 0.6, 0.3), max(hump, q.w * 0.5)) * (0.6 + 0.5 * lit) * mix(vec3(0.78, 1.0, 0.96), vec3(1.0), lit);
  // the moss garden's cover stops at the bare way: the path stays visible through the garden
  c1 = mix(c1, mossC, sw.x * (1.0 - m.r));
  c2 = mix(c2, mossC * 0.92, sw.x * (1.0 - m.r));
  c1 = jitter(c1, r.wzy, 0.5);
  c2 = jitter(c2, q.wzy, 0.5);
  // leaves lie any way round, though those that fell together lie much alike; the moss touches each turn their own way
  // (a slow noise alone gave neighbours the same turn, which read as one stamp repeated)
  float a = (texture(tNoise, xz / 6.3).a * 0.5 + q.y * 0.3 + r.x * 0.45) * TAU;
  d.dir = vec3(cos(a), 0.0, sin(a));
  d.pos = P;
  // the garden's litter is short, round touches (moss); elsewhere the leaves are long
  float shrink = mix(1.0, 0.7, sw.y);
  // the moss touches are as wide as they are long: round, not blades
  // the moss touches vary in width and length more (0.7x to 1.3x of the base), so no two read as one stamp
  // in the garden the touches are about twice as wide as before (0.8 to 1.0 of the cell), so 3 per cell cover the ground
  float wide = (1.05 + 0.5 * r.z) * mix(1.0, 0.6 * (0.85 + 0.3 * r.y), sw.x);
  d.size = uCell0 * vec2(wide, mix(mix(1.7 + 0.9 * r.w, 0.8 + 0.7 * r.w, sw.x) * shrink, wide * (0.85 + 0.3 * r.w), sw.x)) * lod;
  d.c1 = hazed(c1, P);
  d.c2 = hazed(c2, P);
  d.seed = dot(cell, vec2(1.0, 57.0)) + sub * 0.37;
  d.turnabout = 1.0;
  // the touches stand up to the eye (lie 0): flat on the ground they were foreshortened to slivers at grazing angles,
  // and the bare ground between them showed as flat olive
  d.lie = 0.0;
  d.nrm = Nn;
  // in the moss garden the cushions rise into hummocks: some tufts stand up to 0.12 m higher
  // round mounds of moss in the garden, 1 to 2 m across: the crown of each is bright green, its hollow dark
  c1 = mix(c1, mix(vec3(0.2, 0.3, 0.1), vec3(0.62, 0.78, 0.26), hump), sw.x * 0.85);
  d.height = ((0.03 + 0.07 * q.z) + sw.x * (0.12 * q.w + 0.45 * hump)) * pow(lod, 0.35);
  d.glaze = 1.0;
  // the moss garden's touches are the brush's short fat dabs (marks 4 and 5 of the sheet), not the long leaf marks,
  // so the cover reads as small round dots of moss, not as clover leaves
  d.cell = mix(-1.0, 4.0 + step(0.5, r.w), sw.x);
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
  if (bareCover(coverClass(foot)) || wetCover(foot)) { d.alive = 0.0; return; }
  vec4 m = texture(tLand, landUv(foot));
  vec4 sw = segW(m.a);
  // it grows in drifts, keeps off the way, and fills the clearing
  float drift = smoothstep(0.46, 0.7, texture(tNoise, foot / 37.0).a);
  // the moss garden keeps most of its cells painted (it was 20 per cent, and the bare underpainting showed through as
  // flat olive polygons with stair edges)
  float chance = max(0.05 + 0.8 * drift, m.g) * (1.0 - m.r) * (1.0 - 0.25 * sw.x);
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

// the bare ground of a place (T2): sand, rock and built-up ground painted in dabs like the wood's floor, so that it
// reads as paint and not as a flat fill. The dabs lie flat, in the colour of their class; the basalt by the sea is dark.
const bare = /* glsl */ `
void makeDab(inout Dab d) {
  vec2 cell; float sub;
  if (!ringCell(20.0, true, cell, sub)) { d.alive = 0.0; return; }
  vec4 r = hash4(cell, sub * 3.0 + 7.0);
  vec4 q = hash4(cell + 13.1, sub + 5.0);
  vec2 xz = (cell + r.xy) * uCell0;
  float lod;
  d.alive = ringGrow(distance(xz, cameraPosition.xz), lod);
  if (d.alive <= 0.0) return;
  float cls = coverClass(xz);
  bool sand = abs(cls - 6.0) < 0.5, rock = abs(cls - 5.0) < 0.5, built = abs(cls - 8.0) < 0.5, water = abs(cls - 9.0) < 0.5, paved = abs(cls - 10.0) < 0.5, basalt = abs(cls - 11.0) < 0.5, road = abs(cls - 12.0) < 0.5;
  if (!(sand || rock || built || water || paved || basalt || road)) { d.alive = 0.0; return; }
  // the top of a town stream's wall: its stone and paving are drawn (streamwalls.js); a dab on the ground's ramp under it
  // stood up through the top and the face
  if (abs(coverStream(xz) - 2.0) < 0.5) { d.alive = 0.0; return; }
  // a third of the cells lay no dab, so the cell grid does not show as a tile pattern
  if (q.w < 0.33 && !(paved || road)) { d.alive = 0.0; return; }
  vec3 P = vec3(xz.x, heightAt(xz), xz.y);
  // basalt: the cells gather into rounded blocks on a 1.8 m grid (each with its own offset). The dabs rise in the middle
  // of a block and die toward its edge, so a block is a rounded mound and not a square stack
  float dome = 1.0;
  if (basalt) {
    vec2 g = floor(xz / 1.8);
    vec2 bc = (g + 0.5) * 1.8 + (fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * vec2(0.8, 0.8);
    float dd = distance(xz, bc) / 0.95;
    dome = sqrt(max(0.0, 1.0 - dd * dd));
    if (dome < 0.05) { d.alive = 0.0; return; }
  }
  vec3 Nn = normalAt(xz);
  float lit = woodSunAt(P + vec3(0.0, 0.2, 0.0)) * clamp(dot(Nn, uSunDir) * 2.4, 0.0, 1.0);
  float wet = 0.0;
  if (rock || basalt) {
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(k == 0 ? 3.0 : k == 1 ? -3.0 : 0.0, k == 2 ? 3.0 : k == 3 ? -3.0 : 0.0);
      wet = max(wet, abs(coverClass(xz + o) - 9.0) < 0.5 ? 1.0 : 0.0);
    }
  }
  vec3 c;
  // basalt: almost black with a faint warm cast, pocked: the holes (q.z) are darker and the strokes short
  if (basalt) {
    // basalt on the shore: a mound of dark lava blocks. The dabs high on it catch the sky (pale grey), the sides and
    // the foot are nearly black, and the foot by the water is wet: darker still
    c = q.y > 0.7 ? paint3(vec3(0.44, 0.45, 0.48), vec3(0.3, 0.31, 0.34), vec3(0.2, 0.2, 0.22), lit, q.x)
                   : paint3(vec3(0.16, 0.15, 0.16), vec3(0.1, 0.095, 0.1), vec3(0.06, 0.06, 0.07), lit, q.x);
    if (wet > 0.5) c *= 0.7;
  }
  // a town stream (bridges-6): grey-green and slate over its stones, a pebble's warm grey here and there; the sea and
  // the rivers keep their teal
  else if (water && abs(coverStream(xz) - 1.0) < 0.5) c = r.x > 0.78 ? paint3(vec3(0.58, 0.56, 0.5), vec3(0.46, 0.44, 0.4), vec3(0.32, 0.31, 0.29), lit, q.y)
                                                                   : paint3(vec3(0.5, 0.58, 0.55), vec3(0.37, 0.45, 0.43), vec3(0.25, 0.31, 0.31), lit, q.y);
  else if (water) c = paint3(vec3(0.36, 0.6, 0.62), vec3(0.24, 0.46, 0.52), vec3(0.16, 0.34, 0.4), lit, q.y);
  else if (sand) c = paint3(vec3(0.94, 0.85, 0.64), vec3(0.78, 0.68, 0.48), vec3(0.6, 0.5, 0.36), lit, q.y);
  else if (rock && wet > 0.5) c = paint3(vec3(0.3, 0.3, 0.32), vec3(0.2, 0.2, 0.22), vec3(0.12, 0.12, 0.14), lit, q.y);
  else if (rock) {
    // granite (T2 check 5): a lit face and a shaded face with a hard edge between, dark mineral flecks, and dark seams
    c = paint3(vec3(0.92, 0.87, 0.82), vec3(0.7, 0.66, 0.63), vec3(0.46, 0.44, 0.43), clamp(lit * 1.15 - 0.05, 0.0, 1.0), q.y);
    if (r.x > 0.85) c = mix(c, vec3(0.3, 0.29, 0.29), 0.4);
    if (q.z < 0.12) c *= 0.8;
  }
  // paved ground (T4, paved.js): grey stone and gravel, with no tree or litter on it
  else if (paved) c = paint3(vec3(0.66, 0.64, 0.6), vec3(0.52, 0.5, 0.47), vec3(0.36, 0.34, 0.32), lit, q.y);
  // a town's road (T3 round 7): dark asphalt grey, so the street reads apart from the pale pavement and the palace stone
  else if (road) c = paint3(vec3(0.44, 0.44, 0.45), vec3(0.34, 0.34, 0.35), vec3(0.23, 0.23, 0.24), lit, q.y);
  else c = paint3(vec3(0.7, 0.62, 0.52), vec3(0.52, 0.45, 0.38), vec3(0.34, 0.3, 0.26), lit, q.y);
  c = jitter(c, r.wzy, 0.4);
  // the strokes run down the slope: along the horizontal part of the normal (rock and sand alike), with a little
  // turn either way; on flat ground the turn alone decides
  vec2 down = length(Nn.xz) > 0.02 ? normalize(Nn.xz) : vec2(1.0, 0.0);
  float a = atan(down.y, down.x) + (q.x - 0.5) * 0.7;
  // water: short strokes lying across the view (T2 check 4), with only a slight turn
  if (water) a = (q.x - 0.5) * 0.25;
  d.dir = vec3(cos(a), 0.0, sin(a));
  d.pos = P;
  // basalt stands: a mound of blocks, the dabs stacked from the foot (q.y low) to the top (q.y high), facing the eye
  if (basalt) { d.pos = P + vec3(0.0, (0.3 + 0.3 * q.w) * dome * q.y, 0.0); d.dir = vec3(0.0, 1.0, 0.0); }
  // paved ground is covered: the stones are larger and no cell is left bare
  float grow = paved || road ? 1.6 : 1.0;
  d.size = uCell0 * (water ? vec2(0.7 + 0.5 * r.z, 1.5 + 0.9 * r.w) : basalt ? vec2(1.6 + 1.0 * r.z, 0.9 + 0.6 * r.w) : vec2(0.8 + 0.9 * r.z, 1.2 + 1.6 * r.w)) * grow * lod;
  d.c1 = hazed(c, P);
  d.c2 = hazed(jitter(c, q.wzy, 0.5), P);
  d.seed = dot(cell, vec2(1.0, 57.0)) + sub * 0.37 + 2.0;
  d.turnabout = 1.0;
  d.lie = basalt ? 0.0 : 1.0;
  d.nrm = Nn;
  d.height = 0.02 + 0.03 * q.z;
  d.glaze = 1.0;
}
`;

export function createFloor(shared) {
  const carpetRings = groundRings(shared, { head: LITTER + SEG_GLSL + COVER_GLSL, body: carpet, per: 3, n: 192, cell0: 0.14, levels: 6, minPx: [5, 9], maxPx: [4000, 4000], cells: [0, 8] });
  const growthRings = groundRings(shared, { head: LITTER + SEG_GLSL + COVER_GLSL, body: growth, per: 6, n: 96, cell0: 0.42, levels: 4, minPx: [2.5, 12], maxPx: [60, 420], cells: [0, 4] });
  const bareRings = groundRings(shared, { head: COVER_GLSL + SEG_GLSL, body: bare, per: 2, n: 128, cell0: 0.3, levels: 4, minPx: [3, 8], maxPx: [900, 900], cells: [0, 4] });
  const group = new THREE.Group();
  group.add(carpetRings.group, growthRings.group, bareRings.group);
  return { group, follow(x, z) { carpetRings.follow(x, z); growthRings.follow(x, z); bareRings.follow(x, z); } };
}
