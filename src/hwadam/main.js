// The hwadam walk: a path through the wood in four parts (moss garden, maple climb, birch wood, ridge view), in oils.
// Shown with ?scene=hwadam (src/scenes.js). A copy of src/main.js; the world it reads is src/hwadam/world.
//   ?capture       no clock: window.lab.step(dt, n) advances it (for stills and films)
//   ?quality=low   fewer leaves in the air, no sun in the mist
//   ?shafts=0 ?canvas=0 ?impasto=0..2    parts of the finish, for comparing
import * as THREE from 'three';
import { patchBlock } from 'patch-block';
import recipe from '../../recipe.json';
import RAPIER from '../figure/rapier/rapier.mjs';
import { createShared, WIND, SUN } from '../oilpaint/common.js';
import { createBrushSheet } from '../oilpaint/brush.js';
import { prepareLand, setPlace, createLand, heightAt, wayDist, noise, way, START, CLEARING, CLEAR, verticalScale } from './world/land.js';
import { bakedPlace, bakePlace, placeFromUrl } from './world/place.js';
import { gazeBearing } from './world/bake.js';
import { viewShares, coverWithin, COVER_GLSL } from './world/cover.js';
import { mountPlacePanel } from './start-panel.js';
import { startMap, openMap, mapOpen, goToPlace } from '../travel/map.js';
import { mountHud } from '../travel/hud.js';
import { mountViewToggle } from '../travel/view-toggle.js';
import { walkSong } from '../travel/walk-song.js';
import { createMidground } from '../travel/midground.js';
import { createFloor } from './world/floor.js';
import { createForest } from './world/forest.js';
import { createSky } from './world/sky.js';
import { createLeaves } from '../world/leaves.js';
import { createKick } from '../world/kick.js';
import { createScenery } from './world/scenery.js';
import { createRanges } from '../travel/ranges.js';
import { createShade } from '../oilpaint/shade.js';
import { createFrame } from '../oilpaint/finish.js';
import { createFigure } from '../figure/figure.js';
import { Animator } from '../figure/animator.js';
import { Player } from '../figure/player.js';
import { Input } from '../figure/input.js';
import { Follow } from '../figure/camera.js';
import { playMusic } from '../music.js';

const q = new URLSearchParams(location.search);
const capture = q.has('capture');
// ?scene=travel: the map is the start (no place named), the walk is first person, and M goes back to the map
const travel = q.get('scene') === 'travel';
// ?quality wins; otherwise Patch's performance mode, where there is one
const lowQuality = () => (q.get('quality') ?? window.patch?.quality ?? 'high') === 'low';

// Patch's page talks to the demo through this. There are no controls yet; it carries loading, ready and hiding.
let shown = true;
let loaded = false;
const block = patchBlock({
  ...recipe.block,
  onSet() {},
  onTrigger() {},
  onVisible(visible) { shown = visible; if (loaded) run(); },
});
block.progress(0.03, 'Laying the ground');
const timings = {};
let mark = performance.now();
const lap = (name) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; };

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(capture ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.getElementById('view').appendChild(renderer.domElement);

const shared = createShared();
// the sun: the autumn sun from ahead (default), or ?sun=side, a low sun from the west, for the ridge test
const SUN_SIDE = new THREE.Vector3(-0.93, 0.36, 0.1).normalize();
const sun = q.get('sun') === 'side' ? SUN_SIDE : SUN.clone();
shared.uSunDir.value.copy(sun);
shared.tBrush.value = createBrushSheet();
if (q.has('impasto')) shared.uImpasto.value = +q.get('impasto');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.2, 2000);
// Listened for from the start, not once loaded: the page may go fullscreen while the world is still being made.
// The frame's target joins in once it exists.
let fitFrame = () => {};
function fitView() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fitFrame();
}
addEventListener('resize', fitView);
lap('start');
// the wanderer's files are the large ones: they start coming down now, while the wood is made
let told = 0;
const say = (value, label) => { told = Math.max(told, value); block.progress(told, label); };
// an autumn hiker: a teal-indigo windbreaker (shirt), dark olive trousers, a slate cap; no cloak
const HIKER = {
  SHIRT: [[0.22, 0.56, 0.62], [0.12, 0.36, 0.48], [0.06, 0.18, 0.3]],
  TROUSERS: [[0.7, 0.6, 0.42], [0.55, 0.46, 0.3], [0.34, 0.28, 0.2]],
  HAT: [[0.9, 0.74, 0.5], [0.7, 0.52, 0.32], [0.42, 0.3, 0.2]],
  BOOTS: [[0.36, 0.24, 0.16], [0.22, 0.15, 0.1], [0.1, 0.07, 0.06]],
};
const figureComing = createFigure(shared, (done) => say(0.05 + 0.55 * done, 'Fetching the wanderer'), HIKER, { longSleeves: true, smallBrim: true });

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
// the ground: the baked Hwadam data, or the place the address names (baked now, from the terrain tiles)
// travel with no place named: the map is the start, and nothing below runs until a spot is picked (by navigation)
if (travel && (!q.get('place') || q.get('err'))) await startMap({ err: q.get('err') ?? '', place: q.get('place') ?? '', name: q.get('name') ?? '' });
const panel = travel ? { progress() {}, done() {}, fail() {} } : mountPlacePanel(q);
let place;
try {
  const request = placeFromUrl(q);
  place = request
    ? await bakePlace({ ...request, onProgress: (f, what) => { panel.progress(f, what); say(0.01 + 0.02 * f, 'Fetching the ground'); } })
    : await bakedPlace();
} catch (err) {
  if (travel) {
    // back to the map, with the spot and the reason
    const next = new URLSearchParams({ scene: 'travel', err: err.code ?? 'net' });
    if (q.get('place')) next.set('place', q.get('place'));
    if (q.get('name')) next.set('name', q.get('name'));
    location.href = `${location.pathname}?${next.toString()}`;
    await new Promise(() => {});
  }
  panel.fail(err);
  throw err;
}
setPlace(place);
panel.done(place.name);
const hud = travel ? mountHud({ name: place.name, keys: 'WASD 걷기 · Shift 달리기 · Space 뛰기 · V 1인칭·3인칭 · M 지도 · B 음악 끄기' }) : null;
if (travel) { const h = document.getElementById('hint'); if (h) h.textContent = 'Click to look · WASD move · Shift sprint · Space jump · V first / third person · M map'; }
await prepareLand((done) => { say(0.03 + 0.07 * done, 'Laying the ground'); return turn(); });
const land = createLand(shared);
lap('land');
say(0.1, 'Growing the wood');
await turn();
// travel: the start is the pin (the centre of the square). The first view looks along the skyline's most layered
// bearing (src/hwadam/world/bake.js gazeBearing), and no trunk stands within 15 m of the pin nor in the 25 degree fan
// out to 40 m along that view. The baked Hwadam walk keeps its own start and view (no clearing).
// (a place with a land cover looks at its sea, or at its rock; see cover.js chooseGaze)
const gazeDeg = travel ? (place.meta.gaze ?? gazeBearing(place.horizon)) : null;
const gazeRad = gazeDeg == null ? 0 : (gazeDeg * Math.PI) / 180;
// the travel start: a vantage point near the pin (highest ground within 150 m); the pin itself on flat ground
const vantage = travel ? place.meta.vantage : { x: 0, z: 0 }; // the start, from the same near square as the skyline
Object.assign(CLEAR, {
  // a place with a cover (T2) clears 30 m round the start, so that the trees in front stand 25 to 40 m off and their crowns
  // reach into the frame (the 15 m clearing put them above its top edge)
  x: vantage.x, z: vantage.z, r: travel ? (place.cover ? 30 : 15) : 0, fan: travel, fx: Math.sin(gazeRad), fz: -Math.cos(gazeRad), fanR: 40, fanCos: Math.cos((25 * Math.PI) / 180),
  laneR: 300, laneCos: Math.cos((20 * Math.PI) / 180), sightCos: Math.cos((35 * Math.PI) / 180), lowH: 0.35,
});
const forest = createForest(shared);
lap('forest');
const floor = createFloor(shared);
const sky = createSky(shared);
// a place's falling leaves keep off the sea, sand, rock and built-up ground (T2); the autumn wood has no exclusion
const leaves = createLeaves(shared, 2400, { head: COVER_GLSL, exclude: 'if (bareCover(coverClass(p.xz))) { d.alive = 0.0; return; }' });
// the shade is taken over the whole walk (its middle, and a box as wide as the ground), not the autumn wood's 330 m
const shade = createShade(renderer, shared, forest.shade, { sun, centre: [-40, 10, 20], box: [270, 270], back: 500, far: 1000 });
lap('shade');
say(0.25, 'Fetching the wanderer');
await turn();
const kick = createKick(shared);
const horizon = place.horizon; // the real skyline round the viewpoint (see tools/fetch-dem.mjs, src/hwadam/world/bake.js)
const scenery = createScenery(shared, horizon, heightAt(CLEARING.x, CLEARING.z) + 1.6);
// the far ranges: the real skyline of three horizon bands (2, 5, 15 km), each a mountain line at its own distance, from the eye (M3, baked Hwadam walk)
// travel (runtime places only: their skyline is taken from the start): the far ranges, one silhouette per band (src/travel/ranges.js)
const rangesMesh = travel
  ? (place.source === 'runtime' ? createRanges(shared, place.horizon, place.meta.bands, vantage.x, heightAt(vantage.x, vantage.z) + 1.6, vantage.z, verticalScale()) : null)
  : createRanges(shared, horizon, [2000, 5000, 15000], CLEARING.x, heightAt(CLEARING.x, CLEARING.z) + 1.6, CLEARING.z, verticalScale());
if (rangesMesh) scene.add(rangesMesh);
scene.add(sky.group, land.mesh, forest.group, floor.group, leaves.mesh, kick.mesh, scenery.group);
// check only (?keysky): the sky dome in pure magenta, its strokes off, so that the picture counts what the sky shows
if (q.has('keysky')) { sky.group.children[0].material = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.BackSide, depthTest: false, depthWrite: false }); sky.group.children[1].visible = false; }
// travel: the real ground out to 2 km, painted, in place of the far wall of the first view (src/travel/midground.js)
const midMesh = travel && place.mid ? createMidground(shared, place.mid, place.way.startHeight) : null;
if (midMesh) scene.add(midMesh);
// check only (?band=k): only the range of band k (bands in place.meta.bands order), in its own colour
if (q.has('band') && rangesMesh) rangesMesh.children.forEach((m, i) => { m.visible = rangesMesh.children.length - 1 - i === Number(q.get('band')); });
// check only (?keyranges): the ranges in pure green, so that the picture counts how much of them stays
if (q.has('keyranges') && rangesMesh) rangesMesh.children.forEach((m) => { m.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide }); });
// travel: the wall rings and the moss stones of scenery.js are built round the way's goal, not round the start, and
// their walls fill the sky from the first view. The mid-ground takes their place, so the group is left out here.
if (travel) scenery.group.visible = false;
// check only (?hide=scenery,floor,forest,sky,land,leaves): switches a part of the picture off, to see what paints a patch
{
  const parts = { scenery: scenery.group, floor: floor.group, forest: forest.group, sky: sky.group, land: land.mesh, leaves: leaves.mesh, mid: midMesh, ranges: rangesMesh, kick: kick.mesh };
  for (const name of (q.get('hide') ?? '').split(',')) if (parts[name]) parts[name].visible = false;
}

// --- the ground and the trunks, for his feet ---
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
{
  // the travel ground is the whole baked square (its boundary is at 250 m), the walk's is the middle 384 m
  const f = travel ? land.heightField(480, 250) : land.heightField();
  physics.createCollider(RAPIER.ColliderDesc.heightfield(f.cells, f.cells, f.heights, { x: 2 * f.half, y: 1, z: 2 * f.half }));
  for (const t of forest.colliders) physics.createCollider(RAPIER.ColliderDesc.cylinder(5, t.r).setTranslation(t.x, t.y + 4.5, t.z));
}
lap('physics');

const figure = await figureComing;
const { man } = figure;
figure.dabs.remove(figure.cloakDabs); // the cloak's dabs stay out: there is no cloak
scene.add(man.object, figure.dabs);
const animator = new Animator(man);
// the walk starts at the pin (the centre of the baked square) in travel, at the way's entrance otherwise
const spawnX = travel ? vantage.x : START.x, spawnZ = travel ? vantage.z : START.z;
const spawn = new THREE.Vector3(spawnX, heightAt(spawnX, spawnZ), spawnZ);
const faceYaw = travel ? Math.PI - gazeRad : Math.atan2(way[3][0] - START.x, way[3][1] - START.z); // travel: the skyline's view; else along the way
const player = new Player({ RAPIER, world: physics, man, animator, spawn, yaw: faceYaw });
const follow = new Follow(camera);
follow.yaw = faceYaw;
// a summit start looks down (place.js: meta.pitch); the other starts keep the camera's own pitch
if (travel && place.meta.pitch != null) follow.pitch = place.meta.pitch;
const input = new Input(renderer.domElement, { pads: !capture && !q.has('nopad') });
physics.step();
lap('figure');

const frame = createFrame(renderer, shared);
fitFrame = () => frame.resize();
frame.uniforms.uCanvas.value = q.has('canvas') ? +q.get('canvas') : 1;
/** Low quality drops the sun in the mist and most of the falling leaves. */
function applyQuality() {
  const low = lowQuality();
  frame.uniforms.uShafts.value = q.has('shafts') ? +q.get('shafts') : low ? 0 : 1;
  leaves.mesh.geometry.instanceCount = low ? 900 : 2400;
}
applyQuality();
window.patch?.addEventListener?.('qualitychange', applyQuality);

// the wind as the cloak feels it: the same bands the leaves move in
const wind = { x: WIND.x, z: WIND.y };
let time = 0;
function air(x, y, z, out) {
  const along = x * wind.x + z * wind.z, across = -x * wind.z + z * wind.x;
  const gust = THREE.MathUtils.clamp(0.5 + 0.8 * noise((along - time * 4) / 40, across / 90) + 0.3 * noise((along - time * 6.5) / 11, across / 17), 0, 1);
  const speed = 0.4 + 3.2 * gust * gust;
  return out.set(wind.x * speed, 0.25 * Math.sin(time * 2.3 + x) * gust, wind.z * speed);
}

function respawn() {
  const half = player.halfHeight();
  player.body.setTranslation({ x: spawn.x, y: spawn.y + player.t.radius + half + 0.05, z: spawn.z }, true);
  physics.propagateModifiedBodyPositionsToColliders();
  player.vel.set(0, 0, 0); player.speed = 0; player.mode = 'move';
  player.feet.copy(spawn); player.prevFeet.copy(spawn); player.visualY = spawn.y; player.grounded = true;
  animator.lock = null; animator.lockOff = null;
  animator.enter(animator.locoState({ strafe: false }), 0.1);
}

const size = new THREE.Vector2();
// the view: first person (his eyes) or third (behind him). V, the button and the wheel switch it in both walks. The
// choice is kept in this browser; a scene's own first view (travel: first, the baked walk: third) is only the default.
const VIEW_KEY = 'oil-forest-view';
const FOLLOW_NEAR = 2.8; // the nearest third-person distance (the clamp in src/figure/camera.js)
const readView = () => { try { const v = localStorage.getItem(VIEW_KEY); return v == null ? null : v === '1'; } catch { return null; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v ? '1' : '0'); } catch { /* blocked: this visit only */ } };
let firstKey = readView() ?? travel;
let first = firstKey ? 1 : 0;
const typingNow = () => { const t = document.activeElement; return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || !!t?.isContentEditable; };
const viewButton = mountViewToggle(() => setView(!firstKey));
function setView(v) { firstKey = v; saveView(v); viewButton.set(v); }
viewButton.set(firstKey);
// the song of the walk: travel picks it by the land round the start (src/travel/walk-song.js); M to the map and back
let walkKey = 'forest';
const outlook = new THREE.Vector3(), eyeAt = new THREE.Vector3(), gaze = new THREE.Vector3(), headAt = new THREE.Vector3();
/** M: the map, centred on where he is (the lat/lon of his place in the baked square). */
function openFromWalk() {
  const c = place.meta.center, p = player.feet;
  const lat = c.lat - p.z / 110940, lon = c.lon + p.x / (111320 * Math.cos((c.lat * Math.PI) / 180));
  document.exitPointerLock?.();
  // the map shows where he is and, if it is another spot, the pin he set out from
  openMap({ lat, lon, pin: { lat: c.lat, lon: c.lon }, back: () => playMusic(walkKey) });
}
addEventListener('keydown', (e) => {
  if (mapOpen() || typingNow() || e.repeat) return;
  if (e.code === 'KeyV') setView(!firstKey);
  if (e.code === 'KeyM' && travel) openFromWalk();
});
function tick(dt) {
  dt = Math.min(dt, 1 / 20);
  time += dt;
  const raw = input.read(dt);
  // the map is open: the keys are for its search box, so the wanderer stands still
  const inp = mapOpen() ? { ...raw, move: { x: 0, y: 0 }, walk: false, sprint: false, strafe: false, jump: false, look: { x: 0, y: 0 } } : raw;
  player.update(dt, inp, follow.yaw);
  // the wood has no wall: far from the way he is turned gently back, and under the world he starts again
  if (player.feet.y < heightAt(player.feet.x, player.feet.z) - 6 || (!travel && wayDist(player.feet.x, player.feet.z) > 78)) respawn();
  // travel: the baked square is the world. Near its edge the mist comes in; past it he is set down at the pin again
  if (travel) {
    const edge = Math.max(Math.abs(player.feet.x), Math.abs(player.feet.z));
    hud.setEdge(Math.min(1, Math.max(0, (edge - 200) / 40)));
    if (edge > 250) respawn();
  }
  const root = player.visualRoot(dt);
  man.object.position.copy(root);
  man.object.rotation.set(0, player.yaw, 0);
  man.object.updateMatrixWorld(true);
  const local = player.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -player.yaw);
  animator.update(dt, { speed: player.mode === 'move' ? player.speed : Math.hypot(local.x, local.z), moveAngle: player.moveAngle, grounded: player.grounded });
  animator.relaxHands(player.speed);
  animator.uprightTrunk(dt, player.speed, player.grounded && player.mode !== 'jump' && player.mode !== 'air' ? 1 : 0.3);
  const lookW = player.mode === 'move' || player.mode === 'idleExtra' ? THREE.MathUtils.clamp(1 - (player.speed - 1.5) / 2, 0, 1) : 0;
  animator.lookToward(dt, camera.getWorldDirection(new THREE.Vector3()), lookW);
  animator.armClearance(dt);
  if (player.mode === 'move' && !player.strafe) animator.leanInto(dt, player.turnRate, player.speed, player.accelF);
  else animator.leanInto(dt, 0, 0, 0);
  const onGround = player.grounded && player.mode !== 'jump' && player.mode !== 'air';
  animator.placeFeet(dt, (x, z, from) => player.ground(x, z, from, 1.4), root.y, onGround ? 1 : 0);
  man.object.updateMatrixWorld(true);
  // the paint on him follows the pose he is in now (the cloth is not used in this walk)
  figure.bodyDabs.update();
  kick.update(dt, root, { x: Math.sin(player.yaw), z: Math.cos(player.yaw) }, player.speed, onGround, heightAt);

  // the wheel: one more notch in from the third person's nearest distance is the first person; out of the first, the
  // third person again at that nearest distance. In the first person the wheel does not move the follow distance.
  let zoom = mapOpen() ? 0 : inp.zoom;
  if (zoom < 0 && !firstKey && follow.want <= FOLLOW_NEAR + 1e-6) { setView(true); zoom = 0; }
  else if (zoom > 0 && firstKey) { setView(false); zoom = 0; }
  else if (firstKey) zoom = 0;
  follow.update(dt, root, inp.look, zoom, (o, d, max) => player.castRay(o, d, max), heightAt);
  headAt.set(root.x, root.y + 1.6, root.z);
  {
    // through his eyes: the eye comes forward into his head and looks where the mouse has it look
    first += ((firstKey ? 1 : 0) - first) * (1 - Math.exp(-6 * dt));
    const fp = first * first * (3 - 2 * first);
    if (fp > 0.002) {
      const cp = Math.cos(follow.pitch), sp = Math.sin(follow.pitch);
      gaze.set(Math.sin(follow.yaw) * cp, -sp, Math.cos(follow.yaw) * cp);
      eyeAt.set(root.x + Math.sin(follow.yaw) * 0.08, root.y + 1.6, root.z + Math.cos(follow.yaw) * 0.08);
      camera.getWorldDirection(outlook).multiplyScalar(6).add(camera.position);
      camera.position.lerp(eyeAt, fp);
      camera.lookAt(outlook.lerp(eyeAt.addScaledVector(gaze, 6), fp));
    }
    man.object.visible = figure.dabs.visible = fp < 0.5;
    camera.fov = 46 + 18 * fp;
    camera.near = travel ? 0.3 - 0.2 * fp : 0.2; // the baked walk keeps its own near plane (0.2) in both views
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  renderer.getDrawingBufferSize(size);
  shared.uTime.value = time;
  shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
  shared.uFocus.value.copy(root);
  floor.follow(camera.position.x, camera.position.z);
  shade.update(scene, root);
  frame.render(scene, camera);
}

window.lab = {
  THREE, scene, player, follow, camera, input, animator, figure, shared, frame, renderer, timings, counts: forest.counts, trees: forest.trees, stonePos: scenery.stonePos, stoneData: scenery.stoneData, heightAt, respawn, way, place,
  /** T2: the share of the first frame's ground rays by land cover class (tools/cover-shots.mjs). */
  coverView: () => viewShares(camera, THREE, heightAt),
  /** T2 check: the cover within 150 m of the start (node counts). */
  startCover: () => coverWithin(CLEAR.x, CLEAR.z, 150),
  /** T2 check: where the eye-level horizon lies in the frame (row from the top, 0 to 1), and the camera's pitch. */
  horizonRow: () => {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const far = new THREE.Vector3(camera.position.x + fwd.x * 1500, camera.position.y, camera.position.z + fwd.z * 1500).project(camera);
    return { row: +((1 - far.y) / 2).toFixed(3), camPitch: +((Math.asin(fwd.y) * 180) / Math.PI).toFixed(1) };
  },
  /** T2 check: the frame (300 m, the 46-degree lens) by the distance from the eye: trees per band, their dabs, and the tiers. */
  treeStats: () => {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const eye = camera.position;
    const bands = { '0-50': { n: 0, dabs: 0 }, '50-120': { n: 0, dabs: 0 }, '120+': { n: 0, dabs: 0 } };
    const tiers = [0, 0, 0];
    let dabs = 0;
    for (const t of forest.trees) {
      const v = new THREE.Vector3(t.x - eye.x, t.y + t.h * 0.5 - eye.y, t.z - eye.z);
      const d = v.dot(fwd);
      if (d <= 0 || v.length() > 300) continue;
      if (!(Math.abs(Math.atan2(v.dot(right), d)) < (36.5 * Math.PI) / 180 && Math.abs(Math.atan2(v.dot(up), d)) < (23 * Math.PI) / 180)) continue;
      const L = v.length();
      const band = L < 50 ? '0-50' : L < 120 ? '50-120' : '120+';
      bands[band].n++; bands[band].dabs += t.dabs ?? 0; dabs += t.dabs ?? 0; tiers[t.tier]++;
    }
    // the stems that stand above their leaves: a tree in frame whose foliage tops out well under its trunk top
    const stems = { n: 0, byKind: {} };
    for (const t of forest.trees) {
      const v = new THREE.Vector3(t.x - eye.x, t.y + t.h * 0.5 - eye.y, t.z - eye.z);
      const d = v.dot(fwd);
      if (d <= 0 || v.length() > 300) continue;
      if (!(Math.abs(Math.atan2(v.dot(right), d)) < (36.5 * Math.PI) / 180 && Math.abs(Math.atan2(v.dot(up), d)) < (23 * Math.PI) / 180)) continue;
      // the bare part is the trunk under the first leaf (the crown's foot), as a share of the tree's height
      const bare = t.leafY0 - t.y, ratio = bare / t.h;
      if (ratio < 0.5 && t.leaves >= 40) continue;
      const kind = t.nearPine ? 'nearPine' : t.conifer ? 'conifer' : ['beech', 'birch', 'oak', 'maple'][t.type] ?? String(t.type);
      stems.n++; stems.byKind[kind] = (stems.byKind[kind] ?? 0) + 1;
    }
    return { bands, tiers, dabs: Math.round(dabs), stems };
  },
  /** T2 check: the trees in the frame within 40 m by tier (0 full, 1 some, 2 far), by the mid of each trunk. */
  treeTiers: () => {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const eye = camera.position, tiers = [0, 0, 0];
    for (const t of forest.trees) {
      const v = new THREE.Vector3(t.x - eye.x, t.y + t.h * 0.5 - eye.y, t.z - eye.z);
      const d = v.dot(fwd);
      if (d <= 0 || v.length() > 40) continue;
      if (Math.abs(Math.atan2(v.dot(right), d)) < (36.5 * Math.PI) / 180 && Math.abs(Math.atan2(v.dot(up), d)) < (23 * Math.PI) / 180) tiers[t.tier]++;
    }
    return tiers;
  },
  /** T2: of the trees with any part in the frame, the share whose crown's lower edge (55% of the height) is in it. */
  crownView: () => {
    // the frame by angle: 36.5 degrees to either side, 23 up and down (the 46-degree lens at 16:9), within 300 m
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const eye = camera.position;
    const inFrame = (x, y, z) => {
      const v = new THREE.Vector3(x - eye.x, y - eye.y, z - eye.z);
      const d = v.dot(fwd);
      if (d <= 0 || v.length() > 300) return false;
      return Math.abs(Math.atan2(v.dot(right), d)) < (36.5 * Math.PI) / 180 && Math.abs(Math.atan2(v.dot(up), d)) < (23 * Math.PI) / 180;
    };
    let any = 0, bottomIn = 0;
    for (const t of forest.trees) {
      if (!(inFrame(t.x, t.y + t.h * 0.3, t.z) || inFrame(t.x, t.y + t.h * 0.55, t.z) || inFrame(t.x, t.y + t.h * 0.8, t.z))) continue;
      any++;
      if (inFrame(t.x, t.y + t.h * 0.55, t.z)) bottomIn++;
    }
    return { any, bottomIn, share: any ? +(bottomIn / any).toFixed(3) : 0 };
  },
  /** T2: conifers in the first frame (within 120 m of the eye) and in the walk. */
  coniferView: () => {
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let inView = 0, total = 0;
    for (const t of forest.trees) {
      if (!t.conifer) continue;
      total++;
      const p = new THREE.Vector3(t.x, t.y + t.h * 0.5, t.z);
      if (f.containsPoint(p) && p.distanceTo(camera.position) < 120) inView++;
    }
    return { inView, total };
  },
  /** T2 check: the largest drop (m) of the ground below the eye along the gaze, within 50 m of the eye. */
  drop50: () => {
    const f = camera.getWorldDirection(new THREE.Vector3()); f.y = 0; f.normalize();
    const eye = camera.position.y; let worst = 0;
    for (let t = 0; t <= 50; t += 1) worst = Math.max(worst, eye - heightAt(camera.position.x + f.x * t, camera.position.z + f.z * t));
    return +worst.toFixed(1);
  },
  /** T2 check: the midground's height (absolute m) within r m of (x, z): min, max, and the cells counted. */
  midSpan: (x, z, r) => {
    const md = place.mid; if (!md) return null;
    let lo = Infinity, hi = -Infinity, n = 0;
    for (let j = 0; j < md.n; j++) for (let i = 0; i < md.n; i++) {
      const cx = -md.half + i * md.step, cz = -md.half + j * md.step;
      if (Math.hypot(cx - x, cz - z) > r) continue;
      const v = md.h[j * md.n + i]; lo = Math.min(lo, v); hi = Math.max(hi, v); n++;
    }
    return { min: +lo.toFixed(1), max: +hi.toFixed(1), n, step: md.step };
  },
  /** T2 check: the meshes with a given vertex count, with their parent, material, box and visibility. */
  meshesWithVerts: (n) => {
    const out = [];
    scene.traverse((o) => {
      const cnt = o.geometry?.attributes?.position?.count;
      if (cnt !== n) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      out.push({ inScene: scene.children.indexOf(o.parent) >= 0, sceneIdx: scene.children.indexOf(o.parent), kids: o.parent?.children.length, name: o.name, parent: o.parent?.name || o.parent?.type || '', parentType: o.parent?.type, mat: o.material?.type, vert: cnt, index: o.geometry.index?.count ?? 0, center: [c.x, c.y, c.z].map((v) => +v.toFixed(0)), size: [s.x, s.y, s.z].map((v) => +v.toFixed(0)), visible: vis, frustumCulled: o.frustumCulled, renderOrder: o.renderOrder, uniforms: o.material?.uniforms ? Object.keys(o.material.uniforms).slice(0, 8) : [] });
    });
    return out;
  },
  /** T2 check: what the picture shows at a screen point (u, v from the top-left): the first visible meshes hit by a ray. */
  pick: (u, v) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), camera);
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const hits = ray.intersectObjects(scene.children, true).filter((h) => shown(h.object)).slice(0, 4);
    return hits.map((h) => ({ at: [+h.point.x.toFixed(0), +h.point.z.toFixed(0), +h.point.y.toFixed(1)], d: +h.distance.toFixed(1), type: h.object.type, name: h.object.name || (h.object.parent && h.object.parent.name) || '', mat: h.object.material?.type ?? '', vert: h.object.geometry?.attributes?.position?.count ?? 0 }));
  },
  /** T2 check: the trees whose trunk is in the frame (300 m), with their screen place (u, v in 0..1, from the top-left) and shape. */
  frameTrees: () => {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const eye = camera.position, out = [];
    for (const t of forest.trees) {
      const v = new THREE.Vector3(t.x - eye.x, t.y + t.h * 0.5 - eye.y, t.z - eye.z);
      const d = v.dot(fwd);
      if (d <= 0 || v.length() > 300) continue;
      const hz = Math.atan2(v.dot(right), d), vt = Math.atan2(v.dot(up), d);
      // a wider cone than the frame (55 degrees), so that a trunk whose centre lies just outside the edge is listed too
      if (!(Math.abs(hz) < (55 * Math.PI) / 180 && Math.abs(vt) < (35 * Math.PI) / 180)) continue;
      const p = new THREE.Vector3(t.x, t.y + t.h * 0.5, t.z).project(camera);
      out.push({ u: +((p.x + 1) / 2).toFixed(3), v: +((1 - p.y) / 2).toFixed(3), L: +v.length().toFixed(1), kind: t.nearPine ? 'nearPine' : t.conifer ? 'conifer' : ['beech', 'birch', 'oak', 'maple'][t.type] ?? String(t.type), tier: t.tier, h: +t.h.toFixed(1), r: +t.r.toFixed(2), base: +t.y.toFixed(1), top: +(t.y + t.h).toFixed(1), leafY0: +t.leafY0.toFixed(1), leafY1: +t.leafY1.toFixed(1), leaves: t.leaves, dabs: Math.round(t.dabs ?? 0), family: t.family, hero: !!t.hero });
    }
    return out;
  },
  /** T2 check: the midground's heights (absolute m): the cells at sea level (<= 0.5, 1, 3 m), the range, and the entrance height. */
  midStats: () => {
    const m = place.mid;
    if (!m) return null;
    const c = { le05: 0, le1: 0, le3: 0 }; let lo = Infinity, hi = -Infinity;
    for (const v of m.h) { if (v <= 0.5) c.le05++; if (v <= 1) c.le1++; if (v <= 3) c.le3++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return { n: m.n, ...c, min: +lo.toFixed(1), max: +hi.toFixed(1), H0: +place.way.startHeight.toFixed(1) };
  },
  /** T2 check: the feet's ground position, for the walk test (tools/cover-shots.mjs). */
  feet: () => ({ x: player.feet.x, z: player.feet.z }),
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) tick(dt); },
  setInput(fn) { input.override = fn; },
  /** Puts him at (x, z) on the ground, facing (fx, fz), with the eye behind him. */
  teleport(x, z, fx, fz) {
    const y = heightAt(x, z), half = player.halfHeight();
    player.body.setTranslation({ x, y: y + player.t.radius + half + 0.05, z }, true);
    physics.propagateModifiedBodyPositionsToColliders();
    player.feet.set(x, y, z); player.prevFeet.copy(player.feet); player.visualY = y;
    player.vel.set(0, 0, 0); player.speed = 0; player.mode = 'move'; player.grounded = true;
    player.yaw = player.lastYaw = Math.atan2(fx - x, fz - z);
    follow.yaw = player.yaw; follow.pivot.set(0, 0, 0);
    animator.lock = null; animator.lockOff = null;
    animator.enter(animator.locoState({ strafe: false }), 0.05);
    tick(1 / 60);
  },
  /** A fixed view for stills: eye and what it looks at. Call with nothing to go back to following him. */
  view(eye, target) { follow.free = eye ? { position: new THREE.Vector3(...eye), target: new THREE.Vector3(...target) } : null; },
  /** For the view check: first person or not, the mix (0 third .. 1 first), the eye's distance from his head, the follow distance, the map. */
  viewState() { return { firstPerson: firstKey, mix: first, headDist: camera.position.distanceTo(headAt), follow: follow.want, mapOpen: mapOpen() }; },
};

// --- warming up: every shader is built and drawn once, and the GPU has caught up, before anyone is let in ---
say(0.68, 'Mixing paint');
/** Resolves when the GPU has done everything it has been sent: JavaScript finishing isn't the GPU finishing. */
function gpuDone() {
  const gl = renderer.getContext();
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return new Promise((resolve) => {
    const poll = () => {
      if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) return void setTimeout(poll, 4);
      gl.deleteSync(sync);
      resolve();
    };
    poll();
  });
}
if (!capture) {
  renderer.debug.checkShaderErrors = false;
  await renderer.compileAsync(scene, camera);
  lap('shaders');
  say(0.86, 'Mixing paint');
}
for (let i = 0; i < (capture ? 1 : 5); i++) {
  tick(1 / 60);
  if (capture) break;
  await gpuDone();
  say(0.88 + 0.025 * i, 'First strokes');
  await turn();
}
lap('first frame');

// Draws while the page says the demo can be seen, and not at all while it can't.
let running = false;
let last = 0;
function run() {
  const want = shown && !capture;
  if (want === running) return;
  running = want;
  last = performance.now();
  renderer.setAnimationLoop(want ? () => { const now = performance.now(); try { tick((now - last) / 1000); } catch (err) { renderer.setAnimationLoop(null); console.error(err); window.__fail?.('그리는 중에 문제가 생겼어요. 새로고침해 주세요.'); } last = now; } : null);
}
if (!capture) {
  const hint = document.getElementById('hint');
  addEventListener('keydown', (e) => { if (e.code === 'KeyH') hint.classList.toggle('off'); });
  setTimeout(() => hint.classList.add('faded'), 9000);
  if (travel) walkKey = walkSong(vantage.x, vantage.z);
  playMusic(walkKey);
}
fitView();
loaded = true;
run();
document.getElementById('loading')?.remove();
if (q.has('clean') || capture) document.getElementById('hint')?.remove();
// the walk's place name and key line (travel HUD) are left out of the clean pictures too
if (q.has('clean') || capture) document.querySelectorAll('.walk-name, .walk-keys').forEach((el) => el.remove());
// the view button is HUD too: left out of the clean and capture pictures; ?hud keeps it (tools/view-check.mjs)
if ((q.has('clean') || capture) && !q.has('hud')) document.getElementById('walk-view')?.remove();
block.ready();
window.lab.ready = true;
// for the measuring tools
window.__block = { ready: true, block, timings, set() {} };
