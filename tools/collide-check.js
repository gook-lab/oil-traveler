// Collision check (T3 r71): the walker against the biggest hall's podium. One walk toward the hall's centre from each
// side, 12 m out: up the front stairs he must climb to the hall's floor; from the others a solid must stop him before
// the posts (the podium's tiers had no collider, and he walked into them). Run inside the GPU lock:
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.5788,126.9770&clean" --eval "$(cat tools/collide-check.js)"
// With no hall (a mountain), it walks into the nearest tree of the farther tiers instead: a trunk must stop him.
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.6588,126.9772&clean" --eval "$(cat tools/collide-check.js)"
const L = window.lab, P = L.player;
const base = L.input.read(1 / 60);
const halls = L.buildingPlans.filter((p) => p.trad && p.R);
const hall = halls.reduce((a, b) => (b.R.hu * b.R.hv > a.R.hu * a.R.hv ? b : a), halls[0]);
if (!hall) {
  const f0 = L.feet();
  const far = L.trees.filter((t) => t.tier > 0).sort((a, b) => Math.hypot(a.x - f0.x, a.z - f0.z) - Math.hypot(b.x - f0.x, b.z - f0.z)).slice(0, 5);
  const walks = far.map((t) => {
    L.teleport(t.x + 6, t.z, t.x, t.z);
    L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
    let closest = Infinity;
    for (let i = 0; i < 240; i++) {
      L.step(1 / 60, 5);
      // only while his body and the trunk share a height (a tree on a cliff's top stands over him at its foot)
      if (P.feet.y + 1.8 > t.y - 0.6 && P.feet.y < t.y + t.h) closest = Math.min(closest, Math.hypot(P.feet.x - t.x, P.feet.z - t.z));
    }
    L.setInput(null);
    return { tier: t.tier, r: +t.r.toFixed(2), closest: +closest.toFixed(2) };
  });
  return { trees: walks, pass: walks.every((w) => w.closest > w.r) };
}
const R = hall.R;
const cx = R.cu * R.ux + R.cv * R.vx, cz = R.cu * R.uz + R.cv * R.vz;
const sides = [[R.ux, R.uz, R.hu], [-R.ux, -R.uz, R.hu], [R.vx, R.vz, R.hv], [-R.vx, -R.vz, R.hv]];
const front = sides.reduce((b, c) => (c[1] > b[1] ? c : b));
const walk = (o) => {
  const sx = cx + o[0] * (o[2] + 12), sz = cz + o[1] * (o[2] + 12);
  L.teleport(sx, sz, cx, cz);
  L.setInput(() => ({ ...base, move: { x: 0, y: 1 } }));
  const g0 = L.heightAt(sx, sz);
  let closest = Infinity, rise = -Infinity;
  for (let i = 0; i < 300; i++) {
    L.step(1 / 60, 10);
    const f = P.feet;
    closest = Math.min(closest, (f.x - cx) * o[0] + (f.z - cz) * o[1] - o[2]); // metres out from the posts
    rise = Math.max(rise, f.y - g0);
  }
  L.setInput(null);
  return { front: o === front, closestFromPosts: +closest.toFixed(2), rise: +rise.toFixed(2) };
};
const walks = sides.map(walk);
// pass: up the front he climbs to the hall's floor (2.2 m or more over the court, the posts' wall stops him); from every
// other side a solid stops him at the upper tier (2.5 m out) or before, never at the posts
const pass = walks.every((w) => (w.front ? w.rise > 2.2 && w.closestFromPosts < 1 : w.closestFromPosts > 2.5));
return { hall: { hu: +R.hu.toFixed(1), hv: +R.hv.toFixed(1), h: hall.h }, colliders: L.buildings?.colliders, walks, pass };
