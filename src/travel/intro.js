// The first screen and the guide: a first visit sees the painting and the title, then four cards on how the map and the walk
// work. A viewer who has seen them goes straight to the map. The map's 가이드 button shows the cards again. The memory is
// one localStorage flag; when storage is blocked the guide simply shows each time. ?intro=skip leaves it out (the checks).
import './travel.css';

const KEY = 'oil-forest:intro-seen';
const CARDS = [
  { img: 'intro/card1.jpg', title: '지도에서 가고 싶은 곳을 눌러요.', body: '지도를 누르거나 이름을 찾아 보세요. 고른 곳에 붓 자국이 찍혀요.' },
  { img: 'intro/card2.jpg', title: '그곳의 땅 · 숲 · 건물이 유화로 그려져요.', body: '땅과 나무, 건물이 붓 자국으로 그려진 채 나타나요.' },
  { img: 'intro/card3.jpg', title: '걸으며 둘러봐요.', body: 'WASD 나 방향키로 걸어요. 마우스로 둘러보고, V 로 1인칭 · 3인칭을 바꿔요. M 은 지도, B 는 음악이에요.' },
  { img: 'intro/card4.jpg', title: '산 · 바다 · 궁궐 · 도심을 골라 보세요.', body: '땅의 생김새에 따라 풍경이 달라요. 가까운 산부터 시작해도 좋아요.' },
];
const SKIP = new URLSearchParams(location.search).get('intro') === 'skip';

const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* blocked: the guide shows again next time */ } };

// the cards' pictures, fetched and decoded once while the first screen shows; each card puts its own element in, so a
// card never shows an empty frame while its picture decodes (r3: card 3 was caught blank)
let cardArt = null;
const preloadCards = () => (cardArt ??= CARDS.map((c) => { const im = new Image(); im.alt = ''; im.decoding = 'async'; im.src = c.img; im.decode?.().catch(() => {}); return im; }));

/** Runs at a first visit with no place named: the first screen, then the guide. Resolves when the viewer goes on to the map. */
export function runFirstVisit() {
  if (seen() || SKIP) return Promise.resolve();
  preloadCards();
  return new Promise((done) => {
    const el = frame('intro-first');
    el.innerHTML = `
      <img class="intro-art" src="intro/main.jpg" alt="" decoding="async" fetchpriority="high" />
      <div class="intro-head">
        <h1>유화 여행자</h1>
        <p>지도에서 고른 곳을 유화 붓 자국으로 칠해, 한 걸음씩 걷는 여행이에요.</p>
        <button type="button" class="intro-go">떠나기</button>
      </div>`;
    el.querySelector('.intro-go').addEventListener('click', () => {
      el.remove();
      showGuide({ onDone: done });
    });
    el.querySelector('.intro-go').focus({ preventScroll: true });
  });
}

/** The four cards. Skip and the last card's 시작하기 both close it; onDone runs after it is gone. */
export function showGuide({ onDone } = {}) {
  const el = frame('intro-guide');
  let at = 0;
  const finish = () => {
    removeEventListener('keydown', keys);
    el.remove();
    remember();
    onDone?.();
  };
  const keys = (e) => {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  };
  const next = () => { if (at < CARDS.length - 1) { at++; draw(); } else finish(); };
  const prev = () => { if (at > 0) { at--; draw(); } };
  const draw = () => {
    const c = CARDS[at];
    const last = at === CARDS.length - 1;
    el.innerHTML = `
      <article class="intro-card">
        <figure></figure>
        <div class="intro-side">
          <div class="intro-text"><h2>${c.title}</h2><p>${c.body}</p></div>
          <div class="intro-foot">
            <ol class="intro-dots" aria-label="${at + 1} / ${CARDS.length}">${CARDS.map((_, i) => `<li${i === at ? ' aria-current="step"' : ''}></li>`).join('')}</ol>
            <button type="button" class="intro-skip">건너뛰기</button>
            <button type="button" class="intro-next">${last ? '시작하기' : '다음'}</button>
          </div>
        </div>
      </article>`;
    el.querySelector('.intro-card figure').append(preloadCards()[at]);
    el.querySelector('.intro-skip').addEventListener('click', finish);
    el.querySelector('.intro-next').addEventListener('click', next);
    el.querySelector('.intro-next').focus({ preventScroll: true });
  };
  addEventListener('keydown', keys);
  draw();
  return el;
}

function frame(cls) {
  const el = document.createElement('section');
  el.className = `intro ${cls}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '유화 여행자 소개');
  document.body.append(el);
  return el;
}
