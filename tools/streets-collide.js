// T4 check for the street furniture: the masts of the signals (lab.streetMasts) stand on the footway (cover not ROAD = 12),
// and the walker, sent at each of the nearest masts from 6 m off on the footway side, stops at 0.37 m or more from its
// centre (the mast's 0.09 m half width plus the walker's 0.28 m). Run inside the GPU lock:
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.5636,126.9826&clean" --eval "$(cat tools/streets-collide.js)"
const L = window.lab, base = L.input.read(1 / 60);
const f0 = L.feet();
const masts = [...L.streetMasts].sort((a, b) => Math.hypot(a.x - f0.x, a.z - f0.z) - Math.hypot(b.x - f0.x, b.z - f0.z)).slice(0, 6);
const walks = masts.map((m) => {
  const dx = m.x - f0.x, dz = m.z - f0.z, n = Math.hypot(dx, dz) || 1;
  // from the side away from the start: 6 m further out from the mast along the start-to-mast line
  const sx = m.x + (dx / n) * 6, sz = m.z + (dz / n) * 6;
  L.teleport(sx, sz, m.x, m.z);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
  let closest = Infinity;
  for (let i = 0; i < 300; i++) {
    L.step(1 / 60, 5);
    closest = Math.min(closest, Math.hypot(L.feet().x - m.x, L.feet().z - m.z));
  }
  L.setInput(null);
  return { cover: L.coverAt(m.x, m.z), closest: +closest.toFixed(2) };
});
return { masts: walks, count: L.streetMasts.length, onRoad: walks.filter((w) => w.cover === 12).length, pass: walks.length > 0 && walks.every((w) => w.closest >= 0.37 && w.cover !== 12) };
