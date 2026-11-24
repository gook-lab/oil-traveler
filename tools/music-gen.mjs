#!/usr/bin/env node
// 배경음악 생성 — ElevenLabs Eleven Music(POST /v1/music)으로 곡을 만들어 public/music/<key>.mp3 에 둡니다.
// 쓰임: node --env-file=<키 파일> tools/music-gen.mjs [--only <key>] [--dry-run]
//   --dry-run  호출 없이 할 목록과 남은 크레딧만 찍습니다.
// 이미 있는 파일은 건너뛰므로 다시 돌려도 크레딧을 또 쓰지 않습니다.
// 키는 환경 변수 ELEVENLABS_API_KEY 로만 받고, 출력 · 파일 어디에도 남기지 않습니다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { model_id, tracks } = JSON.parse(readFileSync(join(ROOT, 'tools/music-prompts.json'), 'utf8'));
const OUT = join(ROOT, 'public/music');
const BASE = 'https://api.elevenlabs.io/v1';
const CAP = 8000; // 이번 묶음 크레딧 상한
const PER_MIN = 1250; // 90초 한 곡이 약 1,810 크레딧이었습니다(2026-11-24). 넉넉히 잡습니다.

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const dry = args.includes('--dry-run');
const key = process.env.ELEVENLABS_API_KEY ?? '';
if (!key && !dry) throw new Error('ELEVENLABS_API_KEY 가 없습니다');

async function credits() {
  const res = await fetch(`${BASE}/user/subscription`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`구독 조회 실패 ${res.status}`);
  const d = await res.json();
  return d.character_limit - d.character_count;
}

async function compose(t) {
  const res = await fetch(`${BASE}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: t.prompt, music_length_ms: t.seconds * 1000, model_id, force_instrumental: true }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${t.key} 생성 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

const todo = tracks.filter((t) => (!only || t.key === only) && !existsSync(join(OUT, `${t.key}.mp3`)));
const estimate = todo.reduce((s, t) => s + Math.ceil((t.seconds / 60) * PER_MIN), 0);
console.log(`할 곡 ${todo.map((t) => `${t.key}(${t.seconds}s)`).join(' · ') || '없음'} · 예상 ${estimate} 크레딧 · 상한 ${CAP}`);
if (key) console.log(`남은 크레딧 ${await credits()}`);
if (dry || !todo.length) process.exit(0);
if (estimate > CAP) throw new Error(`예상 ${estimate} 이 상한 ${CAP} 을 넘습니다`);

mkdirSync(OUT, { recursive: true });
// 구독 조회의 남은 크레딧은 생성 뒤 늦게 줄어듭니다. 곡마다 재지 않고 예상치로 상한을 지킵니다.
const before = await credits();
for (const t of todo) {
  const audio = await compose(t);
  writeFileSync(join(OUT, `${t.key}.mp3`), audio);
  console.log(`${t.key}: ${(audio.length / 1024).toFixed(0)} KB`);
}
await new Promise((r) => setTimeout(r, 15_000));
console.log(`시작 때 남은 크레딧 ${before} · 지금 ${await credits()} (다른 세션이 같은 계정을 쓰면 차이에 섞입니다)`);
