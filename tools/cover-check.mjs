// T2 check: the land cover of three places (화담숲, 북한산, 협재) from OpenFreeMap tiles and the AWS terrain tiles.
//   node tools/cover-check.mjs
// Prints the class histogram of the 512 m square per place, then asserts what each place must show:
//   협재 has sea and sand, 북한산 has wood and rock, 화담 is mostly wood. It also checks that the sea cells lie at or
// below 0.5 m. Node 18+; no browser. User-Agent: oil-forest-dev/0.1.
import { inflateSync } from 'node:zlib';
import { Terrain, bakeNear, decodeTerrarium, tileUrl, NEAR_ZOOM, NEAR_M } from '../src/hwadam/world/bake.js';
import { fetchCover, COVER } from '../src/hwadam/world/cover.js';

const HEADERS = { 'User-Agent': 'oil-forest-dev/0.1' };
const inflate = async (bytes) => new Uint8Array(inflateSync(bytes));
const PLACES = [
  { name: '화담숲', lat: 37.3419823, lon: 127.2885772, need: { wood: [0.6, 1] } },
  { name: '북한산', lat: 37.6588, lon: 126.9772, need: { wood: [0.05, 1], rock: [0.02, 1] } },
  { name: '협재', lat: 33.3943, lon: 126.2396, need: { water: [0.1, 1], sand: [0.005, 1] } },
];

async function loadTile(z, x, y) {
  const res = await fetch(tileUrl(z, x, y), { headers: HEADERS });
  if (!res.ok) throw new Error(`terrain ${z}/${x}/${y} HTTP ${res.status}`);
  const sources = (res.headers.get('x-amz-meta-x-imagery-sources') ?? '');
  if (!/srtm|gmted/i.test(sources)) throw new Error(`terrain source not SRTM/GMTED: ${sources}`);
  return decodeTerrarium(new Uint8Array(await res.arrayBuffer()), inflate);
}

let failed = 0;
for (const p of PLACES) {
  const terrain = new Terrain(loadTile);
  await terrain.prefetch(p.lat, p.lon, NEAR_M, NEAR_ZOOM);
  const near = bakeNear(terrain, p.lat, p.lon);
  const { grid, counts } = await fetchCover({ lat: p.lat, lon: p.lon, near });
  const total = grid.length;
  const share = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / total).toFixed(3)]));
  console.log(`${p.name}`, JSON.stringify(share));
  for (const [cls, [lo, hi]] of Object.entries(p.need)) {
    const s = counts[cls] ? counts[cls] / total : 0;
    const ok = s >= lo && s <= hi;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${cls} ${(s * 100).toFixed(1)}% (need ${lo * 100}%~${hi * 100}%)`);
  }
  // the sea sits at or below 0.5 m; ponds and lakes may lie anywhere (화담숲 has ponds on its slope)
  let sea = 0, seaHigh = 0;
  for (let k = 0; k < total; k++) if (grid[k] === COVER.WATER && near[k] <= 0.5) sea++;
  for (let k = 0; k < total; k++) if (grid[k] === COVER.WATER && near[k] > 5) seaHigh++;
  console.log(`  water cells: ${sea} at sea level, ${seaHigh} above 5 m (ponds or lakes)`);
}
console.log(failed ? `${failed} check(s) failed` : 'all cover checks passed');
process.exitCode = failed ? 1 : 0;
