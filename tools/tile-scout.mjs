// Counts what the OpenFreeMap z14 tile under a point carries for the street work (T4): the transportation lines by
// class · subclass · brunnel, the paths that cross a road, the buildings (with heights), and the poi classes.
//   node tools/tile-scout.mjs 37.4979,127.0276 [37.5126,126.9960 ...]
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const TILE_JSON = 'https://tiles.openfreemap.org/planet';
const tj = await (await fetch(TILE_JSON)).json();
const Z = 14;
const tileXY = (lat, lon) => {
  const n = 2 ** Z, x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};
const bump = (m, k, by = 1) => { m[k] = (m[k] ?? 0) + by; };
for (const arg of process.argv.slice(2)) {
  const [lat, lon] = arg.split(',').map(Number);
  const { x, y } = tileXY(lat, lon);
  const res = await fetch(tj.tiles[0].replace('{z}', Z).replace('{x}', x).replace('{y}', y));
  const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  const out = { at: arg, tile: `${Z}/${x}/${y}`, layers: Object.keys(vt.layers) };
  const T = vt.layers.transportation, cls = {}, brunnel = {}, keys = {};
  for (let i = 0; T && i < T.length; i++) {
    const p = T.feature(i).properties;
    bump(cls, `${p.class}${p.subclass ? '/' + p.subclass : ''}`);
    if (p.brunnel) bump(brunnel, `${p.brunnel}:${p.class}`);
    for (const k of Object.keys(p)) bump(keys, k);
  }
  out.transportation = { n: T?.length ?? 0, cls, brunnel, keys };
  const B = vt.layers.building;
  let withH = 0, hs = [];
  for (let i = 0; B && i < B.length; i++) { const p = B.feature(i).properties; if (p.render_height != null) { withH++; hs.push(p.render_height); } }
  hs.sort((a, b) => a - b);
  out.building = { n: B?.length ?? 0, withH, h50: hs[Math.floor(hs.length / 2)], h90: hs[Math.floor(hs.length * 0.9)] };
  const P = vt.layers.poi, poi = {};
  for (let i = 0; P && i < P.length; i++) bump(poi, P.feature(i).properties.class);
  out.poi = poi;
  const W = vt.layers.water, wcls = {};
  for (let i = 0; W && i < W.length; i++) bump(wcls, W.feature(i).properties.class);
  out.water = wcls;
  console.log(JSON.stringify(out));
}
