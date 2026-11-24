// The far ranges of the travel walk: one silhouette per horizon band (place.meta.bands, six for a place baked at run
// time), each at its band's distance from the start, rising to the band's real elevation angle (place.horizon). The
// far ones are drawn first, so the near ones stand in front of them; the far ones are lighter and bluer and carry less
// contrast, and their strokes run level. Nothing is a fixed wall: the tops come from the ground the bake read, and the
// bottoms sit at the eye, so each range is a mass that rises from the horizon, not a plane over the sky.
import * as THREE from 'three';
import { COMMON } from '../oilpaint/common.js';

const NEAR_COL = [0.34, 0.38, 0.4], FAR_COL = [0.7, 0.77, 0.86];

/**
 * Builds the ranges. `horizon` is 360 bearings per band (0 north, clockwise; radians of elevation, from the eye); `bands`
 * the band distances in metres; the eye stands at (ex, ey, ez) in world metres; `VS` is the vertical scale of the ground
 * (the angles are of the true ground, the world's ground is scaled by VS, so the tops are scaled the same way).
 */
export function createRanges(shared, horizon, bands, ex, ey, ez, VS) {
  const group = new THREE.Group();
  const nb = bands.length;
  for (let b = nb - 1; b >= 0; b--) {
    const d = bands[b], t = nb > 1 ? b / (nb - 1) : 0; // t: 0 near, 1 far
    const pos = new Float32Array(361 * 2 * 3);
    for (let a = 0; a <= 360; a++) {
      const az = (a * Math.PI) / 180, th = horizon[b * 360 + (a % 360)];
      const top = ey + d * Math.tan(th) * VS;
      const bottom = ey - 2;
      const x = ex + Math.sin(az) * d, z = ez - Math.cos(az) * d;
      pos.set([x, Math.max(bottom, top), z], a * 6);
      pos.set([x, bottom, z], a * 6 + 3);
    }
    const index = [];
    for (let a = 0; a < 360; a++) {
      const p = a * 2, q = p + 1, r = p + 2, s = p + 3;
      index.push(p, q, r, q, s, r); // counter-clockwise seen from inside the ring: the front faces the eye
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(index);
    const near = NEAR_COL, far = FAR_COL;
    const col = near.map((v, i) => v + (far[i] - v) * t);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: shared,
      vertexShader: /* glsl */ `
        ${COMMON}
        out vec3 vWorld;
        void main() { vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        in vec3 vWorld;
        layout(location = 0) out vec4 outC;
        void main() {
          // level strokes: the noise stretched along the bearing, not up the slope
          float s = texture(tNoise, vec2(atan(vWorld.x, vWorld.z) * 60.0, vWorld.y * 0.12) / 95.0).r;
          vec3 c = vec3(${col.map((v) => v.toFixed(3)).join(', ')}) * (0.93 + 0.14 * s);
          // the air takes more of the far ones, so they lie flat against the sky
          vec3 air = airColour(normalize(vWorld - cameraPosition));
          outC = vec4(mix(c, air, clamp(${(0.25 + 0.35 * t).toFixed(3)} * mistBetween(vWorld) + 0.1, 0.0, 1.0)), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -b; // far (large b) first
    group.add(mesh);
  }
  return group;
}
