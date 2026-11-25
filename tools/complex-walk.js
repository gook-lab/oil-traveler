// Walk check of the apartment complexes' walls (apartments-1, src/travel/complex.js): at the middle of the wall runs
// nearest the start, he walks from the pavement into the wall for 3 s and must stay on the pavement's side; at the
// entrances nearest the start he walks in from the pavement for 4 s and must come out 2 m or more inside the line.
// Run inside the GPU lock:
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.505,126.997&clean" --eval "$(cat tools/complex-walk.js)"
const L = window.lab, C = L.complexes;
if (!C) return { none: true };
const sp = L.feet();
const base = L.input.read(1 / 60);
const near = (p) => Math.hypot(p.x - sp.x, p.z - sp.z);
const walkIn = (x, z, e, back, secs) => {
  L.teleport(x - e[0] * back, z - e[1] * back, x + e[0] * 10, z + e[1] * 10);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
  let most = -Infinity;
  for (let i = 0; i < secs * 4; i++) { L.step(1 / 60, 15); most = Math.max(most, (L.player.feet.x - x) * e[0] + (L.player.feet.z - z) * e[1]); }
  L.setInput(null);
  return +most.toFixed(2);
};
const walls = C.runs.map((r) => ({ ...r, x: (r.a[0] + r.b[0]) / 2, z: (r.a[1] + r.b[1]) / 2, len: Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) }))
  .filter((r) => r.len >= 6).sort((p, q) => near(p) - near(q)).slice(0, 6);
const wallTests = walls.map((r) => { const most = walkIn(r.x, r.z, r.e, 2.5, 3); return { at: [+r.x.toFixed(1), +r.z.toFixed(1)], most, blocked: most < 0 }; });
const gateTests = C.gates.slice().sort((p, q) => near(p) - near(q)).slice(0, 4).map((g) => { const most = walkIn(g.x, g.z, g.e, 4, 4); return { at: [+g.x.toFixed(1), +g.z.toFixed(1)], w: g.w, most, entered: most > 2 }; });
return { stats: C.stats, walls: wallTests, gates: gateTests, wallsBlocked: wallTests.filter((t) => t.blocked).length, gatesEntered: gateTests.filter((t) => t.entered).length };
