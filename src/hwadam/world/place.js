// Which ground the walk is built on. Without ?place= it is the baked Hwadam data (src/hwadam/data, no network).
// With ?place=LAT,LON it bakes that place now, in the browser, from the same terrain tiles (src/hwadam/world/bake.js).
// Either way the result has the same shape: { source, name, near, horizon, way, meta }.
import { Terrain, PlaceError, RUNTIME_ZOOMS, RUNTIME_BANDS, RUNTIME_BAND_ZOOMS, tileUrl, decodeTerrarium, bakeNear, bakeHorizon, prefetchSkyline, findWay, waterShare, pickVantage, bakeMidground, NEAR_M, NEAR_STEP, NEAR_ZOOM, BANDS } from './bake.js';
import { loadHorizon } from './horizon.js';
import { fetchCover, chooseGaze, frameNear, ridgeNear, ridgeDeg } from './cover.js';
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
  // the baked skyline was taken from the way's goal; the travel start (vantage) is picked from the same near square
  const vantage = pickVantage(near, meta.nearN, meta.nearStep);
  return { source: 'baked', name: BAKED_NAME, near, horizon: await loadHorizon(), way: wayData, meta: { ...meta, vantage, viewAt: 'goal' } };
}

/** Reads ?place=LAT,LON (and &name=, &zooms=13,12,11 for checks). Returns null when there is no place. */
export function placeFromUrl(q) {
  const p = q.get('place');
  if (!p || p === 'hwadam') return null; // place=hwadam is the baked data (the map's preset pin)
  const [lat, lon] = p.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new PlaceError('badparam');
  // check mode (zooms=a,b,c): the three bands of the baked data; otherwise the runtime's six bands
  const checkZooms = q.get('zooms') ? q.get('zooms').split(',').map(Number) : null;
  const bands = checkZooms ? BANDS : RUNTIME_BANDS, zooms = checkZooms ?? RUNTIME_BAND_ZOOMS;
  const viewAt = q.get('view') === 'goal' ? 'goal' : 'vantage'; // check mode: the skyline from the way's goal, as the baked data
  if (checkZooms && (checkZooms.length !== 3 || checkZooms.some((z) => !Number.isInteger(z) || z < 7 || z > 13))) throw new PlaceError('badparam', 'zooms');
  return { lat, lon, zooms, bands, viewAt, name: (q.get('name') || '').trim() || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
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
export async function bakePlace({ lat, lon, zooms = RUNTIME_BAND_ZOOMS, bands = RUNTIME_BANDS, viewAt = 'vantage', name, onProgress = () => {} }) {
  const sources = new Set();
  const terrain = new Terrain(tileLoader(sources));
  onProgress(0.05, 'ground');
  await terrain.prefetch(lat, lon, NEAR_M, NEAR_ZOOM);
  const near = bakeNear(terrain, lat, lon);
  if (waterShare(near) > 0.5) throw new PlaceError('water');
  // the middle ground: the ground out to 2 km, on a 24 m grid (only the travel walk uses it)
  await terrain.prefetch(lat, lon, 2050, NEAR_ZOOM);
  const mid = bakeMidground(terrain, lat, lon, 2000, 24);
  const N = NEAR_M / NEAR_STEP;
  const way = findWay(near, N, NEAR_STEP);
  if (way.length < 80) throw new PlaceError('noway', `way ${way.length} m`);
  // the land cover (T2) first: the start has to stand on land of the cover. A failure leaves the place painted as
  // plain ground (no cover), and the walk still opens
  let cover = null, coverError = '';
  try {
    cover = await fetchCover({ lat, lon, near, onProgress: (f) => onProgress(0.05 + 0.2 * f, 'cover') });
  } catch (e) {
    coverError = e.message;
  }
  onProgress(0.3, 'skyline');
  // the skyline is taken from the travel start (the vantage point), so that it matches where he stands; or, for the
  // check against the baked data, from the way's goal (the baked skyline's point)
  const grid = cover?.grid ?? null;
  // the start looks at what the first frame is made of (T2): a mountain (rock on 5% of the square) at its rock, a
  // coast (sea on 5%) at its sea; elsewhere the plain pick
  const share = (cls) => (grid ? grid.reduce((n, v) => n + (v === cls ? 1 : 0), 0) / grid.length : 0);
  const focus = !grid ? null : share(5) > 0.05 ? 5 : share(9) > 0.05 ? 9 : null;
  // a mountain's start: the rock it can see, and the highest ridge of the midground over it (60 points a degree)
  const bonus = !focus ? null : focus === 5
    ? (x, z) => 400 * Math.min(0.3, frameNear(grid, near, way.startHeight, x, z, 5)) + 60 * Math.max(-30, ridgeNear(mid, near, N, NEAR_STEP, x, z))
    : (x, z) => 400 * frameNear(grid, near, way.startHeight, x, z, focus);
  const vantage = pickVantage(near, N, NEAR_STEP, 150, grid, bonus);
  const view = viewAt === 'goal' ? { x: way.goal[0], z: way.goal[1] } : { x: vantage.x, z: vantage.z };
  await prefetchSkyline(terrain, lat, lon, view, zooms, bands);
  onProgress(0.7, 'skyline');
  const { horizon, eye } = bakeHorizon(terrain, lat, lon, view, zooms, bands);
  // the first view's bearing: toward the sea or the rock when the square holds some (T2), else the skyline rule
  const gaze = chooseGaze(horizon, grid, near, vantage, way.startHeight, mid);
  // a mountain whose first view has no ridge above the eye (a summit pin) looks down about 8 degrees (pitch 0.14),
  // so that the skyline lies a third of the way down from the top of the frame; otherwise the start pitch (0.05)
  let pitch = 0.05;
  if (focus === 5 && mid && gaze != null) {
    const j = Math.round(N / 2 - vantage.z / NEAR_STEP), i = Math.round(vantage.x / NEAR_STEP + N / 2);
    if (ridgeDeg(mid, near[j * N + i], vantage.x, vantage.z, gaze) <= 0) pitch = 0.14;
  }
  onProgress(1, 'done');
  const meta2 = {
    cover: cover ? cover.counts : null, coverError, gaze,
    center: { lat, lon }, view, nearM: NEAR_M, nearStep: NEAR_STEP, nearN: N, bands, eye,
    zooms, viewAt, vantage, pitch, runtime: true, source: 'AWS Terrain Tiles (terrarium, Tilezen/Mapzen)', sources: [...sources].sort(),
  };
  return { source: 'runtime', name, near, horizon, way, mid, meta: meta2, cover };
}

/** The region a person knows a place by: the county or city, else the province (Nominatim's address parts). */
const regionOf = (a = {}) => a.county || a.city || a.town || a.state || a.province || '';
/** What kind of place a Nominatim result is, in a word a visitor reads. */
const KIND = { peak: '봉우리', mountain: '산', park: '공원', nature_reserve: '자연보호구역', water: '물', forest: '숲', river: '강', beach: '해변', island: '섬', city: '도시', town: '읍·면', village: '마을', hamlet: '마을', suburb: '동네', residential: '동네', viewpoint: '전망', attraction: '명소', administrative: '행정구역' };
const kindOf = (r) => KIND[r.type] || KIND[r.addresstype] || KIND[r.category] || '장소';
/** A short label for a Nominatim result: its first two parts, the rest cut (the full name is long). */
// (a distance or a time that OpenStreetMap stores in the name, such as "1.1Km 00:27", is left out)
const shortName = (display) => String(display ?? '').split(',').map((s) => s.trim()).filter((s) => s && !/\bkm\b|\d+:\d+/i.test(s)).slice(0, 2).join(', ');
const subOf = (r) => [regionOf(r.address), kindOf(r)].filter(Boolean).join(' · ');

/**
 * Up to `limit` matches for a typed name, in OpenStreetMap search (Nominatim, one request). Each is { lat, lon, label,
 * box } where box is the result's own bounding box ([[west, south], [east, north]]) when it has one.
 */
export async function geocodeMany(query, limit = 5) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${limit}&accept-language=ko&q=${encodeURIComponent(query)}`;
  let res;
  try { res = await fetch(url); } catch { throw new PlaceError('net', 'geocode'); }
  if (!res.ok) throw new PlaceError('net', `geocode HTTP ${res.status}`);
  const list = await res.json();
  return list.map((r) => {
    const b = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null; // [south, north, west, east]
    return {
      lat: Number(r.lat), lon: Number(r.lon), label: (r.name && !/\bkm\b/i.test(r.name) ? r.name : shortName(r.display_name)) || query, sub: subOf(r),
      box: b && b.every(Number.isFinite) && b[1] - b[0] > 0.0005 ? [[b[2], b[0]], [b[3], b[1]]] : null,
    };
  });
}

/** The name, region and kind of the place at (lat, lon) (Nominatim reverse, one request). Null when there is none. */
export async function reverseName(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=14&accept-language=ko&lat=${lat}&lon=${lon}`;
  let res;
  try { res = await fetch(url); } catch { throw new PlaceError('net', 'reverse'); }
  if (!res.ok) throw new PlaceError('net', `reverse HTTP ${res.status}`);
  const r = await res.json();
  if (!r || !r.display_name) return null;
  return { label: (r.name && !/\bkm\b/i.test(r.name) ? r.name : shortName(r.display_name)), sub: subOf(r) };
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
