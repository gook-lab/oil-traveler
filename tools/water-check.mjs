// 한 점 둘레에 물(water) 폴리곤이 있는지 OpenFreeMap z14 벡터 타일에서 봅니다(T2 중경 확인용).
//   node tools/water-check.mjs --lat 37.3419823 --lon 127.2885772 --east 271 --south 678 --r 300
// 기준점에서 동쪽 east m, 남쪽 south m 의 점을 잡고, 그 둘레 r m 안에 물 폴리곤 꼭짓점이 있는지, 점이 물 안인지 셉니다.
// 네트워크는 OpenFreeMap 타일만 씁니다. 개인 정보를 보내지 않습니다(User-Agent 없음).
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback; };
const lat0 = flag('lat', 37.3419823), lon0 = flag('lon', 127.2885772);
const east = flag('east', 0), south = flag('south', 0), R = flag('r', 300), Z = 14;
const M_LAT = 111320;
const lat = lat0 - south / M_LAT, lon = lon0 + east / (M_LAT * Math.cos((lat0 * Math.PI) / 180));

const tileXY = (la, lo, z) => {
  const n = 2 ** z, x = Math.floor(((lo + 180) / 360) * n);
  const r = (la * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};
const meta = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const template = meta.tiles[0];
const { x, y } = tileXY(lat, lon, Z);
const url = template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
const res = await fetch(url);
if (!res.ok) throw new Error(`tile ${Z}/${x}/${y} HTTP ${res.status}`);
const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
const n = 2 ** Z;
const toLL = (ext, px, py) => {
  const lo = ((x + px / ext) / n) * 360 - 180;
  const m = Math.PI - (2 * Math.PI * (y + py / ext)) / n;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(m)), lon: lo };
};
// local metres from the test point: east, south
const toM = (p) => ({ e: (p.lon - lon) * M_LAT * Math.cos((lat * Math.PI) / 180), s: -(p.lat - lat) * M_LAT });
const inside = (pt, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const L = vt.layers.water;
const out = { tile: `${Z}/${x}/${y}`, pointLL: [+lat.toFixed(6), +lon.toFixed(6)], layers: Object.keys(vt.layers), waterFeatures: 0, containsPoint: 0, verticesWithinR: 0, nearest: null };
if (L) {
  out.waterFeatures = L.length;
  const pt = { x: 0, y: 0 };
  for (let f = 0; f < L.length; f++) {
    const feat = L.feature(f);
    if (feat.type !== 3) continue;
    const rings = feat.loadGeometry().map((ring) => ring.map((p) => toM(toLL(L.extent, p.x, p.y))));
    for (const ring of rings) {
      if (inside(pt, ring.map((q) => ({ x: q.e, y: q.s })))) out.containsPoint++;
      for (const q of ring) {
        const d = Math.hypot(q.e, q.s);
        if (d <= R) out.verticesWithinR++;
        if (!out.nearest || d < out.nearest.d) out.nearest = { d: +d.toFixed(1), e: +q.e.toFixed(0), s: +q.s.toFixed(0), class: feat.properties.class ?? '', intermittent: feat.properties.intermittent ?? null };
      }
    }
  }
}
console.log(JSON.stringify(out, null, 2));
