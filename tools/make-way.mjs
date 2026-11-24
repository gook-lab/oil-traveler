// Draws the walk over the baked ground (src/hwadam/data/near.bin): the entrance is the lowest spot in the south of the
// inner ground, the viewpoint the highest spot in its north, and the way between them is the least-cost path that
// keeps to gentle slopes. The way is written as control points for the scene's Catmull-Rom curve (src/hwadam/world/land.js)
// to src/hwadam/data/way.json. Run it by hand after fetch-dem.mjs; the demo never calls out.
//   node tools/make-way.mjs
// World coordinates: x east, z south (so north is -z), metres from the centre of the baked ground.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const dir = join(here, 'src/hwadam/data');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const N = meta.nearN, STEP = meta.nearStep;
const buf = readFileSync(join(dir, 'near.bin'));
const H = new Float32Array(buf.buffer, buf.byteOffset, N * N);
const h = (i, j) => H[j * N + i];
const INNER = [32, N - 33]; // keep the entrance and the viewpoint off the edge of the ground

let low = null, high = null;
for (let j = INNER[0]; j <= INNER[1]; j++) {
  for (let i = INNER[0]; i <= INNER[1]; i++) {
    if (j < N / 2 && (!low || h(i, j) < low.h)) low = { i, j, h: h(i, j) };
    if (j >= N / 2 && (!high || h(i, j) > high.h)) high = { i, j, h: h(i, j) };
  }
}

// least-cost path over the 8-neighbour grid: distance, and a penalty that grows with the square of the slope
const key = (i, j) => j * N + i;
const cost = (i0, j0, i1, j1) => {
  const d = Math.hypot(i1 - i0, j1 - j0) * STEP;
  const s = Math.abs(h(i1, j1) - h(i0, j0)) / d;
  return d * (1 + 6 * s * s);
};
const dist = new Float64Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1);
const startK = key(low.i, low.j), goalK = key(high.i, high.j);
dist[startK] = 0;
// a binary heap of [cost, key]
const heap = [];
const push = (c, k) => { heap.push([c, k]); let x = heap.length - 1; while (x > 0) { const p = (x - 1) >> 1; if (heap[p][0] <= heap[x][0]) break; [heap[p], heap[x]] = [heap[x], heap[p]]; x = p; } };
const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let x = 0; for (;;) { const l = 2 * x + 1, r = l + 1; let m = x; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === x) break; [heap[m], heap[x]] = [heap[x], heap[m]]; x = m; } } return top; };
push(0, startK);
while (heap.length) {
  const [c, u] = pop();
  if (u === goalK) break;
  if (c > dist[u]) continue;
  const ui = u % N, uj = (u - ui) / N;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const wi = ui + di, wj = uj + dj;
    if (wi < INNER[0] || wi > INNER[1] || wj < INNER[0] || wj > INNER[1]) continue;
    const w = key(wi, wj), nc = c + cost(ui, uj, wi, wj);
    if (nc < dist[w]) { dist[w] = nc; prev[w] = u; push(nc, w); }
  }
}
const cells = [];
for (let k = goalK; k !== -1; k = prev[k]) cells.push([k % N, Math.floor(k / N)]);
cells.reverse();

// control points: one every 12 cells (24 m) along the path, averaged over the cells around each, so the curve is gentle
const points = [];
for (let k = 0; k < cells.length; k += 12) {
  const lo = Math.max(0, k - 3), hi = Math.min(cells.length - 1, k + 3);
  let si = 0, sj = 0, n = 0;
  for (let q = lo; q <= hi; q++) { si += cells[q][0]; sj += cells[q][1]; n++; }
  points.push([si / n, sj / n]);
}
if (points[points.length - 1][0] !== cells[cells.length - 1][0]) points.push(cells[cells.length - 1]);
// to world metres: the grid's centre is the origin, x east, z south (row j = 0 is the south edge, so z = -(j - N/2) * STEP)
const toWorld = ([i, j]) => [(i - N / 2) * STEP, -(j - N / 2) * STEP].map((v) => Math.round(v * 10) / 10);
const world = points.map(toWorld);
// the walk's length and slope, for the record
let len = 0, gain = 0, slopes = [];
for (let k = 1; k < cells.length; k++) len += Math.hypot(cells[k][0] - cells[k - 1][0], cells[k][1] - cells[k - 1][1]) * STEP;
for (let k = 6; k < cells.length; k += 3) {
  const a = cells[k - 6], b = cells[k];
  slopes.push(Math.abs(Math.atan((h(b[0], b[1]) - h(a[0], a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * STEP))) * 180 / Math.PI);
}
gain = h(high.i, high.j) - h(low.i, low.j);
const out = {
  start: toWorld([low.i, low.j]), goal: toWorld([high.i, high.j]),
  startHeight: low.h, goalHeight: high.h,
  length: Math.round(len), gain: Math.round(gain * 10) / 10,
  slopeMean: Math.round((slopes.reduce((a, b) => a + b, 0) / slopes.length) * 10) / 10,
  slopeMax: Math.round(Math.max(...slopes) * 10) / 10,
  points: world,
};
writeFileSync(join(dir, 'way.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`way.json: ${world.length} points, length ${out.length} m, gain ${out.gain} m, slope mean ${out.slopeMean}° max ${out.slopeMax}°`);
console.log(`start ${out.start} (${out.startHeight.toFixed(1)} m), goal ${out.goal} (${out.goalHeight.toFixed(1)} m)`);
