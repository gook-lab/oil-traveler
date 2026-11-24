// Which ground the walk is built on. Without ?place= it is the baked Hwadam data (src/hwadam/data, no network).
// With ?place=LAT,LON it bakes that place now, in the browser, from the same terrain tiles (src/hwadam/world/bake.js).
// Either way the result has the same shape: { source, name, near, horizon, way, meta }.
import { Terrain, PlaceError, RUNTIME_ZOOMS, tileUrl, decodeTerrarium, bakeNear, bakeHorizon, prefetchSkyline, findWay, waterShare, NEAR_M, NEAR_STEP, NEAR_ZOOM, BANDS } from './bake.js';
import { loadHorizon } from './horizon.js';
import wayData from '../data/way.json';
import meta from '../data/meta.json';
import nearUrl from '../data/near.bin?url';
export { PlaceError };

const BAKED_NAME = '화담숲';

/** Raw inflate for the browser (a PNG's IDAT is a zlib stream). */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The baked Hwadam data, as shipped. */
export async function bakedPlace() {
  const res = await fetch(nearUrl);
  if (!res.ok) throw new PlaceError('net', `near.bin: HTTP ${res.status}`);
  const near = new Float32Array(await res.arrayBuffer());
  return { source: 'baked', name: BAKED_NAME, near, horizon: await loadHorizon(), way: wayData, meta };
}

/** Reads ?place=LAT,LON (and &name=, &zooms=13,12,11 for checks). Returns null when there is no place. */
export function placeFromUrl(q) {
  const p = q.get('place');
  if (!p) return null;
  const [lat, lon] = p.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new PlaceError('badparam');
  const zooms = q.get('zooms') ? q.get('zooms').split(',').map(Number) : RUNTIME_ZOOMS;
  if (zooms.length !== 3 || zooms.some((z) => !Number.isInteger(z) || z < 7 || z > 13)) throw new PlaceError('badparam', 'zooms');
  return { lat, lon, zooms, name: (q.get('name') || '').trim() || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

/** Terrain tiles: a tile counts only when its imagery is SRTM or GMTED2010 (the same guard as tools/fetch-dem.mjs). */
function tileLoader(sources) {
  return async (z, x, y) => {
    let res;
    try { res = await fetch(tileUrl(z, x, y)); } catch { throw new PlaceError('net', `tile ${z}/${x}/${y}`); }
    if (!res.ok) throw new PlaceError('net', `tile ${z}/${x}/${y}: HTTP ${res.status}`);
    const parts = (res.headers.get('x-amz-meta-x-imagery-sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new PlaceError('source', 'no imagery source');
    for (const part of parts) {
      if (!/^(srtm|gmted)\//i.test(part)) throw new PlaceError('source', part);
      sources.add(part);
    }
    return decodeTerrarium(new Uint8Array(await res.arrayBuffer()), inflate);
  };
}

/**
 * Bakes a place from the terrain tiles. onProgress(fraction 0..1, label). Throws PlaceError with a code the page
 * can explain (net, source, water, noway).
 */
export async function bakePlace({ lat, lon, zooms = RUNTIME_ZOOMS, name, onProgress = () => {} }) {
  const sources = new Set();
  const terrain = new Terrain(tileLoader(sources));
  onProgress(0.05, 'ground');
  await terrain.prefetch(lat, lon, NEAR_M, NEAR_ZOOM);
  const near = bakeNear(terrain, lat, lon);
  if (waterShare(near) > 0.5) throw new PlaceError('water');
  const N = NEAR_M / NEAR_STEP;
  const way = findWay(near, N, NEAR_STEP);
  if (way.length < 80) throw new PlaceError('noway', `way ${way.length} m`);
  onProgress(0.3, 'skyline');
  // the view is where the way ends (in the baked Hwadam data the goal and the view are the same point)
  const view = { x: way.goal[0], z: way.goal[1] };
  await prefetchSkyline(terrain, lat, lon, view, zooms);
  onProgress(0.7, 'skyline');
  const { horizon, eye } = bakeHorizon(terrain, lat, lon, view, zooms);
  onProgress(1, 'done');
  const meta2 = {
    center: { lat, lon }, view, nearM: NEAR_M, nearStep: NEAR_STEP, nearN: N, bands: BANDS, eye,
    zooms, runtime: true, source: 'AWS Terrain Tiles (terrarium, Tilezen/Mapzen)', sources: [...sources].sort(),
  };
  return { source: 'runtime', name, near, horizon, way, meta: meta2 };
}

/** Looks a typed address up in OpenStreetMap search (Nominatim). Returns null when nothing matches. */
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ko&q=${encodeURIComponent(query)}`;
  let res;
  try { res = await fetch(url); } catch { throw new PlaceError('net', 'geocode'); }
  if (!res.ok) throw new PlaceError('net', `geocode HTTP ${res.status}`);
  const list = await res.json();
  if (!list.length) return null;
  return { lat: Number(list[0].lat), lon: Number(list[0].lon) };
}
