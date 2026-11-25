// Walk check (fall-through): from the pin, 40 s of running in each of eight bearings; records where the body sinks
// more than 0.6 m below the ground (heightAt) and the respawns that happen before the 250 m edge.
// Run inside the GPU lock:
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.6588,126.9772&clean" --eval "$(cat tools/walk-falls.js)"
const L = window.lab, P = L.player;
const sp = { x: L.feet().x, z: L.feet().z };
const out = { dirs: [] };
const base = L.input.read(1 / 60);
const bottom = () => { const t = P.body.translation(); return t.y - P.t.radius - P.halfHeight(); };
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2, fx = Math.sin(a), fz = Math.cos(a);
  L.teleport(sp.x, sp.z, sp.x + fx * 10, sp.z + fz * 10);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 }, sprint: true }));
  const d = { dir: k * 45, events: [], maxBelow: 0, airRuns: 0, longestAir: 0, end: null };
  let far = 0, air = 0;
  for (let i = 0; i < 240; i++) {
    L.step(1 / 60, 15);
    const f = P.feet, g = L.heightAt(f.x, f.z), b = bottom();
    const below = g - b;
    if (below > d.maxBelow) d.maxBelow = +below.toFixed(2);
    if (below > 0.6 && d.events.length < 6) d.events.push({ t: i / 4, kind: 'below', x: +f.x.toFixed(1), z: +f.z.toFixed(1), ground: +g.toFixed(1), body: +b.toFixed(1), mode: P.mode });
    const dist = Math.hypot(f.x - sp.x, f.z - sp.z);
    if (far > 20 && dist < 3 && d.events.length < 6) d.events.push({ t: i / 4, kind: 'respawn', from: far });
    far = dist;
    if (P.mode === 'air' || P.mode === 'jump') { air++; if (air === 1) d.airRuns++; d.longestAir = Math.max(d.longestAir, air / 4); }
    else air = 0;
  }
  d.end = { x: +P.feet.x.toFixed(1), z: +P.feet.z.toFixed(1), dist: +far.toFixed(1) };
  L.setInput(null);
  out.dirs.push(d);
}
return out;
