// 배경음악: public/music/<key>.mp3 (tools/music-gen.mjs 로 만든 Eleven Music 곡) 을 이어 틉니다.
// 브라우저는 사용자 입력 전 소리를 막으므로, 첫 클릭 · 키 입력에서 AudioContext 를 엽니다.
// 곡 끝의 무음은 잘라 내고, 끝나기 FADE 초 전에 같은 곡을 다시 겹쳐 틀어 이음매를 지웁니다.
// 곡을 바꿀 때도 FADE 초 동안 섞습니다. B 키로 끄고 켜며, 그 선택은 이 브라우저에 기억합니다.

const FADE = 4;
const LEVEL = 0.3; // 곡은 -12 ~ -15 LUFS 로 나옵니다. 걷는 소리 밑에 깔리는 크기로 낮춥니다.
const MUTE_KEY = 'oil-traveler-music-off';

let ctx = null;
let master = null;
let wanted = null; // 열린 뒤 틀 곡(입력 전에 정해질 수 있음)
let playing = null; // { key, gain, timer }
const buffers = new Map();

const readMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
};
let muted = readMuted();

function open() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : LEVEL;
  master.connect(ctx.destination);
  if (wanted) start(wanted);
}

// 곡 끝 쪽에서 들리는 마지막 표본까지를 곡 길이로 봅니다.
function audibleEnd(buffer) {
  const data = buffer.getChannelData(0);
  for (let i = data.length - 1; i > 0; i -= 64) if (Math.abs(data[i]) > 0.004) return i / buffer.sampleRate;
  return buffer.duration;
}

async function load(key) {
  if (!buffers.has(key)) {
    buffers.set(key, fetch(`music/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${key} ${r.status}`))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => ({ buffer, end: audibleEnd(buffer) })));
  }
  return buffers.get(key);
}

// 한 번 틉니다. 앞뒤 FADE 초는 앞 회차 · 다음 회차와 겹쳐 섞입니다.
function pass(track, gain, at) {
  const src = ctx.createBufferSource();
  const fade = ctx.createGain();
  src.buffer = track.buffer;
  src.connect(fade).connect(gain);
  const stop = at + track.end;
  fade.gain.setValueAtTime(0, at);
  fade.gain.linearRampToValueAtTime(1, at + FADE);
  fade.gain.setValueAtTime(1, stop - FADE);
  fade.gain.linearRampToValueAtTime(0, stop);
  src.start(at);
  src.stop(stop);
}

async function start(key) {
  if (playing?.key === key) return;
  const prev = playing;
  const gain = ctx.createGain();
  gain.connect(master);
  const me = { key, gain, timer: 0 };
  playing = me;
  if (prev) {
    clearInterval(prev.timer);
    prev.gain.gain.setValueAtTime(prev.gain.gain.value, ctx.currentTime);
    prev.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
    setTimeout(() => prev.gain.disconnect(), (FADE + 2.5) * 1000);
  }
  let track;
  try { track = await load(key); } catch (err) {
    console.warn('배경음악을 못 불러왔어요', err);
    return;
  }
  if (playing !== me) return;
  // 다음 회차는 소리 시계(ctx.currentTime)로 잽니다. 탭이 숨어 소리가 멈춘 동안에는 예약도 멈춥니다.
  let nextAt = ctx.currentTime + 0.05;
  const tick = () => {
    if (playing !== me || ctx.currentTime < nextAt - 2) return;
    pass(track, gain, nextAt);
    nextAt += track.end - FADE;
  };
  tick();
  me.timer = setInterval(tick, 500);
}

/** 이 곡을 틉니다. 아직 사용자 입력 전이면 입력이 들어오는 순간 틉니다. */
export function playMusic(key) {
  wanted = key;
  if (ctx) start(key);
}

/** 끄고 켭니다. 켜고 끈 상태는 다음 방문에도 이어집니다. */
export function toggleMusic() {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* 저장이 막혀도 이번 방문에서는 따릅니다 */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : LEVEL, ctx.currentTime, 0.2);
  return !muted;
}

addEventListener('pointerdown', open, { once: true, capture: true });
addEventListener('keydown', open, { once: true, capture: true });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && !e.repeat && !(e.target instanceof HTMLInputElement)) toggleMusic();
});
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});
