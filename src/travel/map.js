// The map: where the walk starts (?scene=travel with no place), and where it goes back to with M. MapLibre GL JS
// (lazy-loaded: the walk does not pay for it) over OpenFreeMap's vector tiles (no key). Picking a spot reloads the page
// with ?place=LAT,LON&name=...; the world is then baked for that spot (src/hwadam/world/place.js).
// The pins are circle layers drawn inside the map canvas (not DOM markers), so they move with the map and stay there.
import './travel.css';
import { geocodeMany, reverseName, highestSpot, PlaceError } from '../hwadam/world/place.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const RELIEF = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'; // the same terrain tiles as the walk
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
const HEAD = '· 어디로 떠날까요? 지도를 누르거나 이름을 찾아 보세요';
const kindText = (s) => String(s || '').replace(/\s*·\s*장소$/, '').replace(/^장소$/, ''); // a generic kind (장소) says nothing, so it is left out

let overlay = null, map = null, maplibre = null, chosen = null, onBack = null, ready = false;
let pickMarker = null, pickOn = false; // the chosen spot is a draggable paint dab (a MapLibre marker)
let pins = { pick: null, own: null }; // { lat, lon } or null
let lastReverse = 0, lastList = [];
// read by tools/travel-check.mjs: the pick, the last results and the highest-spot rule, as the page holds them
const testHooks = () => ({ pick: () => pins.pick, results: () => lastList, highestSpot });
export const mapOpen = () => !!overlay && !overlay.hidden;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => v.toFixed(5);
const coords = (lat, lon) => `${fmt(lat)}, ${fmt(lon)}`;

/** Opens the page on another spot. A full load: the world is baked once per spot. */
export function goToPlace(lat, lon, name) {
  const next = new URLSearchParams({ scene: 'travel', place: `${fmt(lat)},${fmt(lon)}`, name });
  location.href = `${location.pathname}?${next.toString()}`;
}

/** The paper look over the OpenFreeMap style: warm ground, muted water and green, thin roads with no shields, one-language labels. */
function paper(m) {
  const tone = { background: '#efe7d2', water: '#bcd2cd', park: '#d6dcbd', building: '#e2d9c5' };
  for (const layer of m.getStyle().layers) {
    try {
      if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', tone.background);
      else if (layer.type === 'fill' && /water/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.water);
      else if (layer.type === 'fill' && /park|grass|wood|forest|landcover/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.park);
      else if (layer.type === 'fill' && /building/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.building);
      // roads: thin, and muted under the paint; the big ones a little stronger
      else if (layer.type === 'line' && /road|bridge|tunnel/.test(layer.id)) {
        m.setPaintProperty(layer.id, 'line-color', /motorway|trunk|primary/.test(layer.id) ? '#b59f7c' : '#cdbf9f');
        m.setPaintProperty(layer.id, 'line-opacity', 0.55);
        m.setPaintProperty(layer.id, 'line-width', /motorway|trunk|primary/.test(layer.id) ? 1.1 : 0.6);
      }
      // road shields (the route numbers in their boxes) are left out at this scale
      else if (layer.type === 'symbol' && /shield|ref/.test(layer.id)) m.setLayoutProperty(layer.id, 'visibility', 'none');
      // labels: the Korean name only, in the ink of the page, with a paper halo
      else if (layer.type === 'symbol') {
        try { m.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]); } catch { /* left as it is */ }
        m.setPaintProperty(layer.id, 'text-color', '#4a3d33');
        m.setPaintProperty(layer.id, 'text-halo-color', '#efe7d2');
      }
    } catch { /* a layer with data-driven colour is left as it is */ }
  }
  // the lie of the land, in the paint's own shades: hillshade over the same terrain tiles the walk uses
  if (!m.getSource('relief')) {
    m.addSource('relief', { type: 'raster-dem', tiles: [RELIEF], encoding: 'terrarium', tileSize: 256, maxzoom: 13 });
    const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addLayer({
      id: 'relief', type: 'hillshade', source: 'relief',
      paint: { 'hillshade-shadow-color': '#6f5a43', 'hillshade-highlight-color': '#fbf3df', 'hillshade-accent-color': '#a88d6a', 'hillshade-exaggeration': 0.4 },
    }, firstSymbol);
  }
}

const point = (p) => (p ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }] } : EMPTY);

/** Puts the pins on the map: the chosen spot (brown) and where the wanderer is (blue). Before the map has loaded they wait. */
function drawPins() {
  if (!ready) return;
  if (pins.pick) {
    pickMarker.setLngLat([pins.pick.lon, pins.pick.lat]);
    if (!pickOn) { pickMarker.addTo(map); pickOn = true; }
  } else if (pickOn) { pickMarker.remove(); pickOn = false; }
  map.getSource('own').setData(point(pins.own));
  map.getSource('tag').setData(pins.pick ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pins.pick.lon, pins.pick.lat] }, properties: { label: chosen?.label ?? '' } }] } : EMPTY);
}

/** The numbered candidates of a search: one pin each, numbered as the list is. */
function drawHits(list) {
  if (!ready) return;
  const features = list.map((r, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { n: String(i + 1) } }));
  map.getSource('hits').setData({ type: 'FeatureCollection', features });
}

function addPinLayers() {
  map.addSource('own', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'own', type: 'circle', source: 'own', paint: { 'circle-radius': 8, 'circle-color': '#2f5a7a', 'circle-stroke-width': 3, 'circle-stroke-color': '#fdf8ec' } });
  // the chosen spot carries its name, and the search results carry their numbers, both as labels on the paper
  map.addSource('hits', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'hits', type: 'circle', source: 'hits', paint: { 'circle-radius': 10, 'circle-color': '#5b4636', 'circle-stroke-width': 2, 'circle-stroke-color': '#fdf8ec' } });
  map.addLayer({ id: 'hit-num', type: 'symbol', source: 'hits', layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fdf8ec' } });
  map.addSource('tag', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'tag', type: 'symbol', source: 'tag', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#2a211b', 'text-halo-color': '#fdf8ec', 'text-halo-width': 2 } });
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
    <div class="tm-head"><b>유화 여행자</b><span>${HEAD}</span></div>
    <form class="tm-search" novalidate>
      <div class="tm-field">
        <input id="tm-q" type="text" autocomplete="off" placeholder="예: 북한산, 협재해변, 화담숲" aria-label="주소나 장소 이름" />
        <button type="button" class="tm-clear" aria-label="검색어 지우기" hidden>×</button>
      </div>
      <button type="submit">찾기</button>
    </form>
    <section class="tm-results" hidden aria-label="검색 결과"></section>
    <p class="tm-status" role="status" aria-live="polite"></p>
    <div class="tm-bar">
      <div class="tm-card" hidden>
        <div class="tm-name"><p class="tm-label"></p><p class="tm-sub"></p></div>
        <button type="button" class="tm-go">여기로 떠나기</button>
      </div>
      <p class="tm-recommend"><span>추천 장소</span> <button type="button" class="tm-hwadam">화담숲 그대로 걷기</button></p>
    </div>
    <button type="button" class="tm-back" hidden>걷기로 돌아가기</button>
    <p class="tm-credit">© OpenStreetMap contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">지형 Terrain Tiles</a></p>`;
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
  // the chosen spot: a paint dab that can be dragged; the name tag follows it, and the spot is looked up when it is let go
  const dab = document.createElement('div');
  dab.className = 'tm-dab';
  pickMarker = new maplibre.Marker({ element: dab, draggable: true, anchor: 'center' });
  pickMarker.on('drag', () => { const ll = pickMarker.getLngLat(); pins.pick = { lat: ll.lat, lon: ll.lng }; drawPins(); });
  pickMarker.on('dragend', () => { const ll = pickMarker.getLngLat(); choose(ll.lat, ll.lng, coords(ll.lat, ll.lng), true); });
  map.on('load', () => { map.resize(); addPinLayers(); });
  addEventListener('resize', () => map?.resize());
  // a click picks the spot and brings it nearer (at least zoom 11)
  map.on('click', (e) => {
    map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 11), duration: 700 });
    choose(e.lngLat.lat, e.lngLat.lng, coords(e.lngLat.lat, e.lngLat.lng), true);
  });
  wire();
  globalThis.__travelTest = testHooks();
  return map;
}

/** Picks a spot: the card shows its name, region and kind (a reverse lookup, once a second at most) or its coordinates. */
async function choose(lat, lon, label, look = false, sub = '') {
  chosen = { lat, lon, label, sub };
  pins.pick = { lat, lon };
  drawPins();
  setCard(label, sub);
  overlay.querySelector('.tm-card').hidden = false;
  overlay.querySelector('.tm-recommend').hidden = true;
  if (look) {
    // one reverse lookup, kept to Nominatim's rate: a second at most between two of them
    const wait = Math.max(0, 1100 - (Date.now() - lastReverse));
    lastReverse = Date.now() + wait;
    await new Promise((r) => setTimeout(r, wait));
    try {
      const found = await reverseName(lat, lon);
      if (found && chosen && chosen.lat === lat && chosen.lon === lon) {
        chosen.label = found.label;
        chosen.sub = found.sub;
        setCard(found.label, found.sub);
        drawPins(); // the name tag follows the lookup
      }
    } catch { /* the coordinates stay as the name */ }
  }
}

function setCard(label, sub) {
  overlay.querySelector('.tm-label').textContent = label;
  overlay.querySelector('.tm-sub').textContent = kindText(sub);
}

function status(text, warn = false) {
  const el = overlay.querySelector('.tm-status');
  el.textContent = text;
  el.className = `tm-status${warn ? ' warn' : ''}`;
}

/** Search results as a list, always (one result too): name, region and kind. Picking one flies there. */
function showResults(list) {
  lastList = list;
  const box = overlay.querySelector('.tm-results');
  box.innerHTML = `<p class="tm-count">${list.length}건 · 줄을 누르면 그곳으로 가요</p><ul>${list.map((r, i) => `<li><button type="button" data-i="${i}"><span class="tm-num">${i + 1}</span><span class="tm-txt"><b>${esc(r.label)}</b><small>${esc(kindText(r.sub))}</small></span><span class="tm-pick">고르기 ›</span></button></li>`).join('')}</ul>`;
  box.hidden = false;
  overlay.querySelector('.tm-recommend').hidden = true;
  drawHits(list);
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => flyTo(list[Number(b.dataset.i)])));
  fitResults(list);
}

/** Frames the results by their points (not their boxes, a park's box is too wide) at the scale of their towns: zoom 11.5 at most. */
function fitResults(list) {
  const pts = list.map((r) => [r.lon, r.lat]);
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) map.easeTo({ center: bounds[0], zoom: 11.5, duration: 900 });
  else map.fitBounds(bounds, { padding: 80, maxZoom: 11.5, duration: 900 });
}

/** A new search clears the last pick: the pin, the card and the chosen spot go, until a result is picked. */
function clearPick() {
  chosen = null;
  pins.pick = null;
  drawPins();
  if (ready) map.getSource('hits').setData(EMPTY);
  overlay.querySelector('.tm-card').hidden = true;
  overlay.querySelector('.tm-recommend').hidden = false;
}

function hideResults() {
  overlay.querySelector('.tm-results').hidden = true;
  overlay.querySelector('.tm-recommend').hidden = !!chosen;
  if (ready) map.getSource('hits').setData(EMPTY);
}

async function flyTo(r) {
  hideResults();
  if (r.box) map.fitBounds(r.box, { padding: 80, maxZoom: 12.5, duration: 1200 });
  else map.flyTo({ center: [r.lon, r.lat], zoom: 12, duration: 1200 });
  // a wide result (a park, a county) gets its pin on the highest ground inside its box, not on its edge
  let spot = null;
  if (r.box && (r.box[1][0] - r.box[0][0] > 0.01 || r.box[1][1] - r.box[0][1] > 0.01)) {
    try { spot = await highestSpot(r.box); } catch { spot = null; }
  }
  choose(spot?.lat ?? r.lat, spot?.lon ?? r.lon, r.label, false, r.sub || '');
}

function wire() {
  const input = overlay.querySelector('#tm-q');
  const clear = overlay.querySelector('.tm-clear');
  input.addEventListener('input', () => { clear.hidden = !input.value; });
  clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; hideResults(); clearPick(); status(''); input.focus(); });
  overlay.querySelector('.tm-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { status('주소나 장소 이름을 먼저 적어 주세요.', true); return; }
    clearPick();
    const coord = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (coord) {
      const lat = Number(coord[1]), lon = Number(coord[2]);
      if (Math.abs(lat) > 85 || Math.abs(lon) > 180) { status(ERRORS.badparam, true); return; }
      showResults([{ lat, lon, label: coords(lat, lon), sub: '좌표' }]);
      return;
    }
    status('찾고 있어요.');
    try {
      const list = await geocodeMany(text, 5);
      if (!list.length) { status('주소를 찾지 못했어요. 장소 이름이나 위도, 경도로 다시 적어 주세요.', true); return; }
      status('');
      showResults(list);
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
    choose(HWADAM.lat, HWADAM.lon, name || '화담숲', false, '경기도 광주시');
  } else if (at && at.length === 2 && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
    map.jumpTo({ center: [at[1], at[0]], zoom: 12.5 });
    choose(at[0], at[1], name || coords(at[0], at[1]));
  }
  if (err) status(ERRORS[err] ?? ERRORS.net, true);
  else if (!chosen) status('');
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
