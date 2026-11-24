// The map: where the walk starts (?scene=travel with no place), and where it goes back to with M. MapLibre GL JS
// (lazy-loaded: the walk does not pay for it) over OpenFreeMap's vector tiles (no key). Picking a spot reloads the page
// with ?place=LAT,LON&name=...; the world is then baked for that spot (src/hwadam/world/place.js).
import './travel.css';
import { geocode, PlaceError } from '../hwadam/world/place.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HWADAM = { lat: 37.3419823, lon: 127.2885772 };
const KOREA = { lat: 36.2, lon: 127.9 };
const ERRORS = {
  water: '이 근처는 대부분 물이라 길을 낼 땅이 부족해요. 다른 곳을 골라 주세요.',
  noway: '이 근처에는 걸을 길을 낼 만한 자리가 없어요. 다른 곳을 골라 주세요.',
  source: '이 곳은 지형 자료를 확인하지 못해 아직 걸을 수 없어요.',
  net: '지형을 받아 오지 못했어요. 잠시 뒤 다시 해 주세요.',
  badparam: '좌표 형식이 맞지 않아요.',
};

let overlay = null, map = null, maplibre = null, marker = null, own = null, chosen = null, onBack = null;
export const mapOpen = () => !!overlay && !overlay.hidden;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => v.toFixed(5);

/** Opens the page on another spot. A full load: the world is baked once per spot. */
export function goToPlace(lat, lon, name) {
  const next = new URLSearchParams({ scene: 'travel', place: `${fmt(lat)},${fmt(lon)}`, name });
  location.href = `${location.pathname}?${next.toString()}`;
}

/** Paper-like tweaks to the OpenFreeMap style: a warm ground, muted water and green. Anything the style lacks is skipped. */
function paper(m) {
  const tone = { background: '#efe7d2', water: '#bcd2cd', park: '#d6dcbd', landcover: '#dfe3c9', building: '#e2d9c5' };
  for (const layer of m.getStyle().layers) {
    try {
      if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', tone.background);
      else if (layer.type === 'fill' && /water/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.water);
      else if (layer.type === 'fill' && /park|grass|wood|forest|landcover/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.park);
      else if (layer.type === 'fill' && /building/.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', tone.building);
    } catch { /* a layer with data-driven colour is left as it is */ }
  }
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
    <p class="tm-status" role="status" aria-live="polite"></p>
    <div class="tm-card" hidden>
      <p class="tm-label"></p>
      <button type="button" class="tm-go">여기로 떠나기</button>
    </div>
    <div class="tm-preset"><button type="button" class="tm-hwadam">화담숲 그대로 걷기</button></div>
    <button type="button" class="tm-back" hidden>걷기로 돌아가기</button>
    <p class="tm-credit">© OpenStreetMap contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a></p>`;
  document.body.append(overlay);
  const canvas = overlay.querySelector('#tm-canvas');
  maplibre = await import('maplibre-gl');
  // the worker is shipped as its own file (vite emits it with a hash); without this MapLibre looks for it beside the chunk
  maplibre.setWorkerUrl(workerUrl);
  map = new maplibre.Map({
    container: canvas, style: STYLE, center: [KOREA.lon, KOREA.lat], zoom: 6.4,
    attributionControl: false, maxZoom: 16,
  });
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors' }), 'bottom-right');
  map.on('style.load', () => paper(map));
  map.on('click', (e) => choose(e.lngLat.lat, e.lngLat.lng, `${fmt(e.lngLat.lat)}, ${fmt(e.lngLat.lng)}`));
  wire();
  return map;
}

function pinElement(cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function setPin(lat, lon) {
  if (!marker) marker = new maplibre.Marker({ element: pinElement('tm-pin') });
  marker.setLngLat([lon, lat]).addTo(map);
}

function choose(lat, lon, label) {
  chosen = { lat, lon, label };
  setPin(lat, lon);
  overlay.querySelector('.tm-label').textContent = label;
  overlay.querySelector('.tm-card').hidden = false;
  overlay.querySelector('.tm-status').textContent = '';
}

function status(text, warn = false) {
  const el = overlay.querySelector('.tm-status');
  el.textContent = text;
  el.className = `tm-status${warn ? ' warn' : ''}`;
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
      map.flyTo({ center: [lon, lat], zoom: 13 });
      choose(lat, lon, `${fmt(lat)}, ${fmt(lon)}`);
      return;
    }
    status('찾고 있어요.');
    try {
      const found = await geocode(text);
      if (!found) { status('주소를 찾지 못했어요. 장소 이름이나 위도, 경도로 다시 적어 주세요.', true); return; }
      map.flyTo({ center: [found.lon, found.lat], zoom: 13 });
      choose(found.lat, found.lon, text);
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
  overlay.querySelector('.tm-back').hidden = true;
  overlay.querySelector('.tm-preset').hidden = false;
  const at = place && place !== 'hwadam' ? place.split(',').map(Number) : null;
  if (place === 'hwadam') {
    map.jumpTo({ center: [HWADAM.lon, HWADAM.lat], zoom: 12.5 });
    choose(HWADAM.lat, HWADAM.lon, name || '화담숲');
  } else if (at && at.length === 2 && Number.isFinite(at[0]) && Number.isFinite(at[1])) {
    map.jumpTo({ center: [at[1], at[0]], zoom: 12.5 });
    choose(at[0], at[1], name || `${fmt(at[0])}, ${fmt(at[1])}`);
  }
  if (err) status(ERRORS[err] ?? ERRORS.net, true);
  else status('지도를 밀거나 눌러 곳을 고르세요.');
  return new Promise(() => {});
}

/**
 * Over the walk: M opens the map centred on the wanderer's place. `back` hides it again. Picking a new spot from here
 * reloads the page on that spot.
 */
export async function openMap({ lat, lon, pin, back }) {
  await ensureMap();
  onBack = back;
  overlay.hidden = false;
  overlay.querySelector('.tm-back').hidden = false;
  overlay.querySelector('.tm-preset').hidden = true;
  if (!own) own = new maplibre.Marker({ element: pinElement('tm-pin tm-own') });
  own.setLngLat([lon, lat]).addTo(map);
  // the spot he set out from (brown), when he has walked away from it: both are on the map
  if (pin) setPin(pin.lat, pin.lon); else marker?.remove();
  map.jumpTo({ center: [lon, lat], zoom: 12.5 });
  chosen = null;
  overlay.querySelector('.tm-card').hidden = true;
  status(pin ? '파란 점은 지금 자리, 갈색 점은 출발한 곳이에요. 다른 곳을 고르면 그곳을 새로 걸어요.' : '다른 곳을 고르면 그곳을 새로 걸어요.');
}
