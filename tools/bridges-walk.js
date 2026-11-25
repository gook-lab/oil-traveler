// Walks every wet road deck of the place along its own polyline (both ways, from 6 m before its start), and reports where
// he stops: the progress along the deck, his height, the deck top there, and the colliders his body touched most. A deck
// the walk reaches the far end of counts as crossed. From an end cut by the square's 240 m edge, the walk starts on the
// deck 4 m in (fromDeck).
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.5690,126.9850&clean" --eval "$(cat tools/bridges-walk.js)"
// (needs `npm run build` first, and CHROME, see CLAUDE.md)
const L = window.lab, P = L.player, base = L.input.read(1 / 60);
const out = [];
const seg = (d) => { const s = [0]; for (let i = 1; i <= d.n; i++) s.push(s[i - 1] + Math.hypot(d.xy[i][0] - d.xy[i - 1][0], d.xy[i][1] - d.xy[i - 1][1])); return s; };
const at = (d, cum, s) => { let i = 0; while (i < d.n - 1 && cum[i + 1] < s) i++; const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return [d.xy[i][0] + (d.xy[i + 1][0] - d.xy[i][0]) * t, d.xy[i][1] + (d.xy[i + 1][1] - d.xy[i][1]) * t]; };
for (const d of L.bridgeDecks.filter((x) => x.road && x.wet)) {
  const cum = seg(d), Lt = cum[d.n];
  const p0 = at(d, cum, 0), p1 = at(d, cum, 1);
  const tx0 = p1[0] - p0[0], tz0 = p1[1] - p0[1], tl = Math.hypot(tx0, tz0) || 1;
  // end ground: the deck's first sample vs the ground 1 m out, and the ground beside it on both sides
  const side = (x, z, nx, nz) => L.heightAt(x + nx * d.hw * 0.9, z + nz * d.hw * 0.9);
  const nx = -tz0 / tl, nz = tx0 / tl;
  const endInfo = { y0: +d.y[0].toFixed(2), g0: +L.heightAt(p0[0], p0[1]).toFixed(2), gOut: +L.heightAt(p0[0] - tx0 / tl, p0[1] - tz0 / tl).toFixed(2), gSideL: +side(p0[0], p0[1], nx, nz).toFixed(2), gSideR: +side(p0[0], p0[1], -nx, -nz).toFixed(2) };
  for (const dir of [1, -1]) {
    // an end cut by the square's edge has no ground before it: that way starts on the deck, 4 m in from the cut
    const fromDeck = (dir > 0 && d.cutA) || (dir < 0 && d.cutB);
    const startS = dir > 0 ? (fromDeck ? 4 : 0) : (fromDeck ? Lt - 4 : Lt);
    const sp = at(d, cum, startS);
    const h = dir > 0 ? [tx0 / tl, tz0 / tl] : [-tx0 / tl, -tz0 / tl];
    // a point 6 m before the deck's start, on the outside of it
    const back = [sp[0] - h[0] * 6, sp[1] - h[1] * 6];
    if (fromDeck) { const ahead = at(d, cum, dir > 0 ? startS + 2 : startS - 2); L.teleport(sp[0], sp[1], ahead[0], ahead[1]); } else L.teleport(back[0], back[1], sp[0], sp[1]);
    L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
    let sMax = -Infinity, stuck = 0, far = false;
    const hits = new Map();
    for (let i = 0; i < 60 * 60; i++) {
      // steer along the polyline, 2 m ahead of his furthest progress
      const f = P.feet;
      const q = at(d, cum, Math.min(Lt, Math.max(0, dir > 0 ? Math.max(sMax, 0) + 2 : Lt - Math.max(sMax, 0) - 2)));
      const want = Math.atan2(q[0] - f.x, q[1] - f.z);
      L.follow.yaw = want; P.yaw = want;
      L.step(1 / 60, 1);
      // progress along the deck (projection of the feet on the polyline, nearest sample)
      let bestS = 0, bestD = Infinity;
      for (let k = 0; k <= d.n; k++) { const dd = Math.hypot(f.x - d.xy[k][0], f.z - d.xy[k][1]); if (dd < bestD) { bestD = dd; bestS = cum[k]; } }
      const sNow = dir > 0 ? bestS : Lt - bestS;
      if (sNow > sMax + 0.05) { sMax = sNow; stuck = 0; } else stuck++;
      const n = P.kcc.numComputedCollisions();
      if (n && sNow > 0 && sNow < Lt - 3) for (let k = 0; k < n; k++) { const c = P.kcc.computedCollision(k); const he = c.collider.shape?.halfExtents; const key = he ? `box${[he.x, he.y, he.z].map((v) => v.toFixed(2)).join('/')}` : `shape${c.collider.shape?.type}`; hits.set(key, (hits.get(key) ?? 0) + 1); }
      if (sMax >= Lt - 2) { far = true; break; }
      if (stuck > 120) break;
    }
    L.setInput(null);
    const stS = Math.max(0, sMax);
    const stP = at(d, cum, dir > 0 ? stS : Lt - stS);
    out.push({
      L: Math.round(Lt), dir, fromDeck, road: d.road, layer: d.layer, wet: d.wet, plateau: d.plateau, gA: d.gA, gB: d.gB,
      y0: endInfo.y0, startGround: +endInfo.g0, gOut: endInfo.gOut, gSide: [endInfo.gSideL, endInfo.gSideR],
      far, stuckAtM: +stS.toFixed(1), feetY: +P.feet.y.toFixed(2), deckTop: L.deckAt(stP[0], stP[1]) == null ? null : +L.deckAt(stP[0], stP[1]).toFixed(2), groundAtStuck: +L.heightAt(stP[0], stP[1]).toFixed(2),
      hits: [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    });
  }
}
return out;
