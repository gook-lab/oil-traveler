// The map: where the walk starts (?scene=travel with no place), and where it goes back to with M. MapLibre GL JS
// (lazy-loaded: the walk does not pay for it) over OpenFreeMap's vector tiles (no key). Picking a spot reloads the page
// with ?place=LAT,LON&name=...; the world is then baked for that spot (src/hwadam/world/place.js).
// The pins are circle layers drawn inside the map canvas (not DOM markers), so they move with the map and stay there.
import './travel.css';
import { geocodeMany, reverseName, PlaceError } from '../hwadam/world/place.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HWADAM = { lat: 37.3419823, lon: 127.2885772 };
const SOUTH_KOREA = { lat: 35.9, lon: 127.8, zoom: 6.1 };
const ERRORS = {
  water: '이 근처는 대부분 물이라 길을 낼 땅이 부족해요. 다른 곳을 골라 주세요.',
  noway: '이 근처에는 걸을 길을 낼 만한 자리가 없어요. 다른 곳을 골라 주세요.',
  source: '이 곳은 지형 자료를 확인하지 못해 아직 걸을 수 없어요.',
  net: '지형을 받아 오지 못했어요. 잠시 뒤 다시 해 주세요.',
  badparam: '좌표 형식이 맞지 않아요.',
};
const EMPTY = { type: 'FeatureCollection', features: [] };

let overlay = null, map = null, maplibre = null, chosen = null, onBack = null, ready = false;
let pins = { pick: null, own: null }; // { lat, lon } or null
let lastReverse = 0;
export const mapOpen = () => !!overlay && !overlay.hidden;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => v.toFixed(5);
const coords = (lat, lon) => `${fmt(lat)}, ${fmt(lon)}`;

/** Opens the page on another spot. A full load: the world is baked once per spot. */
export function goToPlace(lat, lon, name) {
  const next = new URLSearchParams({ scene: 'travel', place: `${fmt(lat)},${fmt(lon)}`, name });
  location.href = `${location.pathname}?${next.toString()}`;
}

/** Paper-like tweaks to the OpenFreeMap style: a warm ground, muted water and green. Anything the style lacks is skipped. */
function paper(m) {
  const tone = { background: '#efe7d2', water: '#bcd2cd', park: '#d6dcbd', building: '#e2d9c5' };
  for (const layer of m.getStyle().layers) {
    try {
      if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', tone.background);
      else if (layer.type === 'fill' && /water/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.water);
      else if (layer.type === 'fill' && /park|grass|wood|forest|landcover/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.park);
      else if (layer.type === 'fill' && /building/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.building);
      // roads sit under the paint: muted, the big ones a little stronger; labels in the ink of the page, with a paper halo
      else if (layer.type === 'line' && /road|bridge|tunnel/.test(layer.id)) {
        m.setPaintProperty(layer.id, 'line-color', /motorway|trunk|primary/.test(layer.id) ? '#b59f7c' : '#cdbf9f');
        m.setPaintProperty(layer.id, 'line-opacity', 0.55);
      }
      else if (layer.type === 'symbol') {
        m.setPaintProperty(layer.id, 'text-color', '#4a3d33');
        m.setPaintProperty(layer.id, 'text-halo-color', '#efe7d2');
      }
    } catch { /* a layer with data-driven colour is left as it is */ }
  }
}

const point = (p) => (p ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }] } : EMPTY);

/** Puts the pins on the map: the chosen spot (brown) and where the wanderer is (blue). Before the map has loaded they wait. */
function drawPins() {
  if (!ready) return;
  map.getSource('pick').setData(point(pins.pick));
  map.getSource('own').setData(point(pins.own));
}

function addPinLayers() {
  map.addSource('own', { type: 'geojson', data: EMPTY });
  map.addSource('pick', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'own', type: 'circle', source: 'own', paint: { 'circle-radius': 8, 'circle-color': '#2f5a7a', 'circle-stroke-width': 3, 'circle-stroke-color': '#fdf8ec' } });
  map.addLayer({ id: 'pick', type: 'circle', source: 'pick', paint: { 'circle-radius': 11, 'circle-color': '#8a3a1c', 'circle-stroke-width': 3, 'circle-stroke-color': '#fdf8ec' } });
  ready = true;
  drawPins();
}

async function ensureMap() {
  if (map) return map;
  overlay = document.createElement('section');
  overlay.id = 'travel-map';
  overlay.className = 'tm';
  overlay.setAttribute('aria-label', '지도에서 걸을 곳 고르기');
  overlay.innerHTML = `
    <div class="tm-canvas" id="tm-canvas"></div>
    <form class="tm-search" novalidate>
      <input id="tm-q" type="text" autocomplete="off" placeholder="주소나 장소 이름" aria-label="주소나 장소 이름" />
      <button type="submit">찾기</button>
    </form>
    <ul class="tm-results" hidden></ul>
    <p class="tm-status" role="status" aria-live="polite"></p>
    <div class="tm-bar">
      <div class="tm-card" hidden>
        <p class="tm-label"></p>
        <button type="button" class="tm-go">여기로 떠나기</button>
      </div>
      <p class="tm-recommend"><span>추천 장소</span> <button type="button" class="tm-hwadam">화담숲 그대로 걷기</button></p>
    </div>
    <button type="button" class="tm-back" hidden>걷기로 돌아가기</button>
    <p class="tm-credit">© OpenStreetMap contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a></p>`;
  document.body.append(overlay);
  maplibre = await import('maplibre-gl');
  // the worker is shipped as its own file (vite emits it with a hash); without this MapLibre looks for it beside the chunk
  maplibre.setWorkerUrl(workerUrl);
  map = new maplibre.Map({
    container: overlay.querySelector('#tm-canvas'), style: STYLE, center: [SOUTH_KOREA.lon, SOUTH_KOREA.lat], zoom: SOUTH_KOREA.zoom,
    attributionControl: false, maxZoom: 16,
  });
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors' }), 'bottom-right');
  map.on('style.load', () => paper(map));
  map.on('load', () => { map.resize(); addPinLayers(); });
  addEventListener('resize', () => map?.resize());
  map.on('click', (e) => choose(e.lngLat.lat, e.lngLat.lng, coords(e.lngLat.lat, e.lngLat.lng), true));
  wire();
  return map;
}

/** Picks a spot: the card shows its name (a reverse lookup, once a second at most) or its coordinates. */
async function choose(lat, lon, label, look = false) {
  chosen = { lat, lon, label };
  pins.pick = { lat, lon };
  drawPins();
  overlay.querySelector('.tm-label').textContent = label;
  overlay.querySelector('.tm-card').hidden = false;
  overlay.querySelector('.tm-results').hidden = true;
  status('');
  if (look) {
    // one reverse lookup, kept to Nominatim's rate: a second at most between two of them
    const wait = Math.max(0, 1100 - (Date.now() - lastReverse));
    lastReverse = Date.now() + wait;
    await new Promise((r) => setTimeout(r, wait));
    try {
      const name = await reverseName(lat, lon);
      if (name && chosen && chosen.lat === lat && chosen.lon === lon) {
        chosen.label = name;
        overlay.querySelector('.tm-label').textContent = name;
      }
    } catch { /* the coordinates stay as the name */ }
  }
}

function status(text, warn = false) {
  const el = overlay.querySelector('.tm-status');
  el.textContent = text;
  el.className = `tm-status${warn ? ' warn' : ''}`;
}

/** Search results as a short list; a single result flies there at once. */
function showResults(list) {
  const ul = overlay.querySelector('.tm-results');
  ul.innerHTML = list.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('');
  ul.hidden = false;
  ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => flyTo(list[Number(b.dataset.i)])));
}

function flyTo(r) {
  overlay.querySelector('.tm-results').hidden = true;
  if (r.box) map.fitBounds(r.box, { padding: 80, maxZoom: 12.5, duration: 1200 });
  else map.flyTo({ center: [r.lon, r.lat], zoom: 12, duration: 1200 });
  choose(r.lat, r.lon, r.label);
}

function wire() {
  const input = overlay.querySelector('#tm-q');
  overlay.querySelector('.tm-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { status('주소나 장소 이름을 먼저 적어 주세요.', true); return; }
    const coord = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (coord) {
      const lat = Number(coord[1]), lon = Number(coord[2]);
      if (Math.abs(lat) > 85 || Math.abs(lon) > 180) { status(ERRORS.badparam, true); return; }
      flyTo({ lat, lon, label: coords(lat, lon) });
      return;
    }
    status('찾고 있어요.');
    try {
      const list = await geocodeMany(text, 5);
      if (!list.length) { status('주소를 찾지 못했어요. 장소 이름이나 위도, 경도로 다시 적어 주세요.', true); return; }
      status(list.length > 1 ? '가까운 곳을 골라 주세요.' : '');
      if (list.length === 1) flyTo(list[0]);
      else showResults(list);
    } catch (err) {
      status(err instanceof PlaceError && err.code === 'net' ? ERRORS.net : '찾지 못했어요. 잠시 뒤 다시 해 주세요.', true);
    }
  });
  overlay.querySelector('.tm-go').addEventListener('click', () => {
    if (chosen) goToPlace(chosen.lat, chosen.lon, chosen.label);
  });
  overlay.querySelector('.tm-hwadam').addEventListener('click', () => {
    const next = new URLSearchParams({ scene: 'travel', place: 'hwadam', name: '화담숲' });
    location.href = `${location.pathname}?${next.toString()}`;
  });
  overlay.querySelector('.tm-back').addEventListener('click', () => {
    overlay.hidden = true;
    onBack?.();
  });
}

/**
 * The start screen. Shown instead of the walk when no place is named. `err` (a PlaceError code) and `place` come back
 * from a failed bake; the map then says why and shows the spot. Never resolves: the walk starts by navigation.
 */
export async function startMap({ err = '', place = '', name = '' } = {}) {
  document.getElementById('loading')?.remove();
  document.documentElement.dataset.scene = 'travel';
  await ensureMap();
  overlay.hidden = false;
  map.resize();
  overlay.querySelector('.tm-back').hidden = true;
  overlay.querySelector('.tm-recommend').hidden = false;
  const at = place && place !== 'hwadam' ? place.split(',').map(Number) : null;
  if (place === 'hwadam') {
    map.jumpTo({ center: [HWADAM.lon, HWADAM.lat], zoom: 12.5 });
    choose(HWADAM.lat, HWADAM.lon, name || '화담숲');
  } else if (at && at.length === 2 && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
    map.jumpTo({ center: [at[1], at[0]], zoom: 12.5 });
    choose(at[0], at[1], name || coords(at[0], at[1]));
  }
  if (err) status(ERRORS[err] ?? ERRORS.net, true);
  else if (!chosen) status('지도를 눌러 갈 곳을 고르세요.');
  return new Promise(() => {});
}

/**
 * Over the walk: M opens the map centred on the wanderer's place. `back` hides it again. Picking a new spot from here
 * reloads the page on that spot. `pin` (the spot he set out from) is drawn too, when it is another point.
 */
export async function openMap({ lat, lon, pin, back }) {
  await ensureMap();
  onBack = back;
  overlay.hidden = false;
  map.resize();
  overlay.querySelector('.tm-back').hidden = false;
  overlay.querySelector('.tm-recommend').hidden = true;
  pins = { own: { lat, lon }, pick: pin ?? null };
  drawPins();
  map.jumpTo({ center: [lon, lat], zoom: 12.5 });
  chosen = null;
  overlay.querySelector('.tm-card').hidden = true;
  status(pin ? '파란 점은 지금 자리, 갈색 점은 출발한 곳이에요. 다른 곳을 고르면 그곳을 새로 걸어요.' : '다른 곳을 고르면 그곳을 새로 걸어요.');
}
