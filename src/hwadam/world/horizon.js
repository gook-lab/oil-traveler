// The real skyline round the viewpoint: for each bearing and each distance band, the highest elevation angle seen
// (radians), baked by tools/fetch-dem.mjs into src/hwadam/data/horizon.bin (3 bands x 360 bearings, 0 north, clockwise).
import horizonUrl from '../data/horizon.bin?url';

export async function loadHorizon() {
  const res = await fetch(horizonUrl);
  if (!res.ok) throw new Error(`horizon.bin: HTTP ${res.status}`);
  const h = new Float32Array(await res.arrayBuffer());
  if (h.length !== 3 * 360) throw new Error('horizon.bin does not hold 3 bands of 360 bearings');
  return h;
}
