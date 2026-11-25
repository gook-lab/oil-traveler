// Frame time standing at the Myeongdong crossing by the near square's edge (skyline-3): 324 m from the start, where the
// far city (src/travel/far.js) stands 60 to 120 m off and draws its storeys. 240 frames, each waited on with a pixel read.
//   tools/with-gpu-lock.sh node tools/probe.mjs --query "scene=travel&place=37.5636,126.9826&clean" --eval "$(cat tools/edge-time.js)"
const L = window.lab, gl = L.renderer.getContext();
L.teleport(-216.8, 241.5, -224.25, 229.62);
L.setInput(() => ({ move: { x: 0, y: 0 }, walk: false, sprint: false, strafe: false, jump: false, look: { x: 0.002, y: 0 }, zoom: 0, device: 'keyboard' }));
const px = new Uint8Array(4);
L.step(1 / 60, 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
const t = performance.now();
for (let i = 0; i < 240; i++) { L.step(1 / 60, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
return +((performance.now() - t) / 240).toFixed(2);
