// The start panel of the hwadam walk: where to walk. A typed address (or "lat, lon") picks the ground; the page then
// loads again with ?place=LAT,LON&name=... so the address can be shared. The default button goes back to Hwadam.
// Hidden with ?capture or ?clean (stills and films keep the picture only).
import './start-panel.css';
import { geocode, PlaceError } from './world/place.js';

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const MESSAGES = {
  notfound: '주소를 찾지 못했어요. 장소 이름이나 위도, 경도로 다시 적어 주세요.',
  water: '이 근처는 대부분 물이라 길을 낼 땅이 부족해요.',
  noway: '이 근처에는 걸을 길을 낼 만한 자리가 없어요.',
  source: '이 곳은 지형 자료를 확인하지 못해 아직 걸을 수 없어요.',
  net: '지형을 받아 오지 못했어요. 잠시 뒤 다시 해 주세요.',
  badparam: '좌표 형식이 맞지 않아요. 위도, 경도 순서로 적어 주세요.',
};
const SUGGEST = ' 화담숲으로 걸어 볼까요?';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Opens the page on another ground (a full load: the world is built once per address). */
function goTo(params) {
  const next = new URLSearchParams();
  next.set('scene', 'hwadam');
  for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
  location.href = `${location.pathname}?${next.toString()}`;
}

export function mountPlacePanel(q) {
  const idle = { progress() {}, fail() {}, done() {} };
  if (q.has('capture') || q.has('clean')) return idle;
  const current = q.get('place');
  const box = document.createElement('section');
  box.id = 'place';
  box.className = 'place';
  box.setAttribute('aria-label', '걸을 곳 고르기');
  box.innerHTML = `
    <form class="place-form" novalidate>
      <label class="place-title" for="place-q">어디를 걸을까요?</label>
      <div class="place-row">
        <input id="place-q" type="text" autocomplete="off" placeholder="주소, 장소 이름, 또는 위도, 경도" />
        <button type="submit" class="place-go">걷기</button>
      </div>
    </form>
    <p class="place-note">입력한 곳은 OpenStreetMap 검색으로 찾아요.</p>
    <p class="place-status" role="status" aria-live="polite"></p>
    <p class="place-alt"><button type="button" class="place-hwadam">화담숲 그대로 걷기</button></p>
    <p class="place-credit">지형 <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>
      · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">출처 목록</a>
      · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></p>`;
  const label = document.createElement('div');
  label.id = 'place-name';
  label.className = 'place-name';
  label.hidden = true;
  document.body.append(box, label);

  const input = box.querySelector('#place-q');
  const status = box.querySelector('.place-status');
  const go = box.querySelector('.place-go');
  const say = (text, cls = '') => { status.className = `place-status ${cls}`; status.innerHTML = text; };
  if (current) input.value = q.get('name') || current;

  box.querySelector('.place-hwadam').addEventListener('click', () => goTo({}));

  box.querySelector('.place-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { say('주소나 장소 이름을 먼저 적어 주세요.', 'warn'); return; }
    go.disabled = true;
    const coord = text.match(COORD);
    try {
      if (coord) {
        const lat = Number(coord[1]), lon = Number(coord[2]);
        if (Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new PlaceError('badparam');
        goTo({ place: `${lat},${lon}`, name: text });
        return;
      }
      say('주소를 찾고 있어요.');
      const found = await geocode(text);
      if (!found) throw new PlaceError('notfound');
      goTo({ place: `${found.lat},${found.lon}`, name: text });
    } catch (err) {
      go.disabled = false;
      fail(err);
    }
  });

  function progress(fraction, what) {
    box.hidden = false;
    say(`땅을 읽고 있어요 · ${Math.round(fraction * 100)}%${what ? ` (${esc(what)})` : ''}`);
  }
  function fail(err) {
    box.hidden = false;
    const code = err instanceof PlaceError ? err.code : 'net';
    const text = MESSAGES[code] ?? MESSAGES.net;
    const suggest = code === 'notfound' || code === 'badparam' ? '' : SUGGEST;
    say(esc(text) + (suggest ? `<br />${esc(suggest.trim())} <a class="place-link" href="${location.pathname}?scene=hwadam">화담숲으로</a>` : ''), 'warn');
    console.warn('[place]', code, err?.message ?? err);
  }
  function done(name) {
    label.textContent = name;
    label.hidden = false;
    say('');
  }
  return { progress, fail, done };
}
