/**
 * Windows and doors on the buildings, drawn by the picture's own program: no extra shapes, no
 * pictures to load. Every wall is divided into bays and floors; each bay has a dark window, and on
 * the ground floor every fourth bay has a door instead. Not meant to be real: the map knows
 * nothing of windows.
 *
 * Buildings differ. Each gets a pattern by its size and by a number worked out from where it
 * stands, so it looks the same on every visit:
 * - small houses: few, squarish windows, often with a cross of glazing bars, sometimes shutters;
 * - houses of several floors: taller windows closer together, some with bars or shutters;
 * - tall or very large buildings: a tight grid, or bands of glass running round each floor.
 * A building at a well-known sight gets no pattern at all: an arch or a tower is not a block of flats.
 *
 * A trial for now, switched on with `?try=windows` in the address and remembered by the browser
 * until `?try=nowindows`.
 */

import { BufferAttribute, type BufferGeometry, type MeshStandardMaterial } from 'three';

const KEPT = '3da-windows';

/** Whether the trial is on in this browser. Reads the address once and remembers. */
export function windowsOn(): boolean {
  try {
    const tries = (new URLSearchParams(location.search).get('try') ?? '').split(',');
    if (tries.includes('windows')) localStorage.setItem(KEPT, '1');
    if (tries.includes('nowindows')) localStorage.removeItem(KEPT);
    return localStorage.getItem(KEPT) === '1';
  } catch {
    return false;
  }
}

/** A number from 0 to 1 out of a spot and a salt, always the same for the same spot. */
function hash(x: number, z: number, salt: number): number {
  let h = (Math.imul(Math.round(x * 4), 0x9e3779b1) ^ Math.imul(Math.round(z * 4), 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** what the bars of a window are: none, a cross of glazing bars, shutters at the sides, a band of glass */
const PLAIN = 0;
const BARS = 1;
const SHUTTERS = 2;
const BAND = 3;

/**
 * Give every building of the mesh its pattern, as two values per corner point:
 * `aWinA` = bay width (m; 0 = no windows), floor height (m), left and right edge of the glass in a bay;
 * `aWinB` = bottom and top edge of the glass in a floor, the kind of bars, a number for small differences.
 * `sights` are spots (metres east and north of the middle) whose building stays bare.
 */
export function styleWindows(geometry: BufferGeometry, sights: Array<{ x: number; y: number }>): void {
  const pos = geometry.getAttribute('position');
  const foot = geometry.getAttribute('aFoot');
  const hag = geometry.getAttribute('aHag');
  const n = pos.count;
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  let from = 0;
  while (from < n) {
    // a building's points lie together, and all carry the middle of its footprint
    const fx = foot.getX(from);
    const fz = foot.getY(from);
    let to = from;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    let high = 0;
    while (to < n && foot.getX(to) === fx && foot.getY(to) === fz) {
      const x = pos.getX(to);
      const z = pos.getZ(to);
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
      high = Math.max(high, hag.getX(to));
      to++;
    }
    const ground = (x1 - x0) * (z1 - z0);
    const r1 = hash(fx, fz, 1);
    const r2 = hash(fx, fz, 2);
    const r3 = hash(fx, fz, 3);
    // scene z runs south: a sight's north is -z
    const bare = sights.some((s) => s.x > x0 - 10 && s.x < x1 + 10 && -s.y > z0 - 10 && -s.y < z1 + 10);
    let A: [number, number, number, number];
    let B: [number, number, number, number];
    if (bare || high < 2.4) {
      A = [0, 3.2, 0, 0];
      B = [0, 0, PLAIN, r3];
    } else if (high > 26 || ground > 2200) {
      // tall or very large: bands of glass, or a tight grid
      if (r1 < 0.45) {
        A = [3, 3.4, -0.01, 1.01];
        B = [0.38, 0.8, BAND, r3];
      } else {
        A = [2.2 + r2 * 0.6, 3.3, 0.14, 0.86];
        B = [0.22, 0.82, PLAIN, r3];
      }
    } else if (high > 9) {
      // several floors: taller windows, closer together
      A = [2.7 + r2 * 0.9, 3.2, 0.26, 0.7 + r1 * 0.06];
      B = [0.24, 0.82, r1 < 0.35 ? BARS : r1 < 0.55 ? SHUTTERS : PLAIN, r3];
    } else {
      // a small house: few, squarish windows
      A = [3.3 + r2 * 1.1, Math.max(2.6, Math.min(3.2, high)), 0.3, 0.66];
      B = [0.34, 0.76, r1 < 0.5 ? BARS : r1 < 0.75 ? SHUTTERS : PLAIN, r3];
    }
    for (let k = from; k < to; k++) {
      a.set(A, k * 4);
      b.set(B, k * 4);
    }
    from = to;
  }
  geometry.setAttribute('aWinA', new BufferAttribute(a, 4));
  geometry.setAttribute('aWinB', new BufferAttribute(b, 4));
}

/** Add windows and doors to the buildings' material, on top of what it already does. */
export function addWindows(mat: MeshStandardMaterial): void {
  const before = mat.onBeforeCompile;
  mat.customProgramCacheKey = () => 'bldg-ao-windows-2';
  mat.onBeforeCompile = (shader, renderer) => {
    before.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWinA;\nattribute vec4 aWinB;\nvarying vec4 vWinA;\nvarying vec4 vWinB;\nvarying vec3 vWinPos;\nvarying vec3 vWinNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWinA = aWinA;\nvWinB = aWinB;\nvWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWinNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWinA;\nvarying vec4 vWinB;\nvarying vec3 vWinPos;\nvarying vec3 vWinNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (abs(vWinNrm.y) < 0.5 && vWinA.x > 0.5) {
  // along the wall and up it, counted in bays and floors
  vec2 along = normalize(vec2(-vWinNrm.z, vWinNrm.x));
  float u = dot(vWinPos.xz, along) / vWinA.x;
  float v = vHag / vWinA.y;
  float fu = fract(u);
  float fv = fract(v);
  // soft edges, and the whole pattern fades from far up, so that it does not flicker
  float eu = fwidth(u) * 1.2 + 0.001;
  float ev = fwidth(v) * 1.2 + 0.001;
  float far = clamp(1.0 - max(eu, ev) * 2.2, 0.0, 1.0);
  float kind = vWinB.z;
  float band = step(2.5, kind);
  float inU = smoothstep(vWinA.z - eu, vWinA.z + eu, fu) * (1.0 - smoothstep(vWinA.w - eu, vWinA.w + eu, fu));
  float inV = smoothstep(vWinB.x - ev, vWinB.x + ev, fv) * (1.0 - smoothstep(vWinB.y - ev, vWinB.y + ev, fv));
  float win = mix(inU, 1.0, band) * inV;
  // a door in every fourth bay of the ground floor; a banded front has a glass ground floor instead
  float doorBay = step(mod(floor(u), 4.0), 0.5) * step(v, 1.0) * (1.0 - band);
  float door = smoothstep(0.28 - eu, 0.28 + eu, fu) * (1.0 - smoothstep(0.7 - eu, 0.7 + eu, fu)) * (1.0 - smoothstep(0.72 - ev, 0.72 + ev, fv));
  // the glass: a little lighter or bluer from one building to the next
  vec3 glass = mix(vec3(0.11, 0.14, 0.19), vec3(0.2, 0.27, 0.34), vWinB.w);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * (1.0 - doorBay) * 0.82 * far);
  // glazing bars: a pale cross through the middle of the glass
  float bars = step(0.5, kind) * step(kind, 1.5);
  float mu = (vWinA.z + vWinA.w) * 0.5;
  float mv = (vWinB.x + vWinB.y) * 0.5;
  float cross = max(1.0 - smoothstep(0.012, 0.012 + eu, abs(fu - mu)), 1.0 - smoothstep(0.014, 0.014 + ev, abs(fv - mv)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.86, 0.8), cross * win * bars * (1.0 - doorBay) * 0.85 * far);
  // shutters: a strip of colour at each side of the glass
  float shut = step(1.5, kind) * step(kind, 2.5);
  float side = (smoothstep(vWinA.z - 0.1 - eu, vWinA.z - 0.1 + eu, fu) * (1.0 - smoothstep(vWinA.z - eu, vWinA.z + eu, fu))
              + smoothstep(vWinA.w - eu, vWinA.w + eu, fu) * (1.0 - smoothstep(vWinA.w + 0.1 - eu, vWinA.w + 0.1 + eu, fu))) * inV;
  vec3 paint = vWinB.w < 0.34 ? vec3(0.2, 0.36, 0.27) : vWinB.w < 0.67 ? vec3(0.42, 0.25, 0.15) : vec3(0.2, 0.32, 0.47);
  diffuseColor.rgb = mix(diffuseColor.rgb, paint, side * shut * (1.0 - doorBay) * 0.9 * far);
  // the door, darker wood or lighter by the building
  vec3 wood = mix(vec3(0.3, 0.17, 0.1), vec3(0.16, 0.2, 0.24), step(0.6, vWinB.w));
  diffuseColor.rgb = mix(diffuseColor.rgb, wood, door * doorBay * 0.9 * far);
}`,
      );
  };
  mat.needsUpdate = true;
}
