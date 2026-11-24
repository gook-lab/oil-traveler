// 사용: node tools/horizon-layers.mjs
// 능선 시점이 보여 줄 층 수를 방위마다 셉니다. horizon.bin 의 세 띠(2 km, 5 km, 15 km)에서
// 층 = 1 + (5km > 2km + 0.4°) + (15km > max(2km, 5km) + 0.4°) 입니다. 층이 3인 방위를 시점 후보로 씁니다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const bin = fileURLToPath(new URL('../src/hwadam/data/horizon.bin', import.meta.url));
const b = readFileSync(bin);
const h = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
const deg = (r) => (r * 180) / Math.PI;
const rows = [];
for (let az = 0; az < 360; az++) {
  const a2 = deg(h[az]), a5 = deg(h[360 + az]), a15 = deg(h[720 + az]);
  const layers = 1 + (a5 > a2 + 0.4 ? 1 : 0) + (a15 > Math.max(a2, a5) + 0.4 ? 1 : 0);
  rows.push({ az, layers, a2, a5, a15 });
}
const three = rows.filter((r) => r.layers === 3).map((r) => r.az);
console.log('bearings with three layers:', three.length ? three.join(' ') : 'none');
console.log('north (0):', rows[0].layers, 'layers', rows[0].a2.toFixed(1), rows[0].a5.toFixed(1), rows[0].a15.toFixed(1));
