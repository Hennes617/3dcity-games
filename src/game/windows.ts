/**
 * Windows and doors on the buildings, drawn by the picture's own program: no extra shapes, no
 * pictures to load. Every wall is divided into bays 3 m wide and floors 3.2 m high; each bay has a
 * dark window, and on the ground floor every fourth bay has a door instead. Not meant to be real:
 * the map knows nothing of windows.
 *
 * A trial for now, switched on with `?try=windows` in the address and remembered by the browser
 * until `?try=nowindows`.
 */

import type { MeshStandardMaterial } from 'three';

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

/** Add windows and doors to the buildings' material, on top of what it already does. */
export function addWindows(mat: MeshStandardMaterial): void {
  const before = mat.onBeforeCompile;
  mat.customProgramCacheKey = () => 'bldg-ao-windows';
  mat.onBeforeCompile = (shader, renderer) => {
    before.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nvarying vec3 vWinNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWinNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nvarying vec3 vWinNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (abs(vWinNrm.y) < 0.5) {
  // along the wall and up it, in metres
  vec2 along = normalize(vec2(-vWinNrm.z, vWinNrm.x));
  float u = dot(vWinPos.xz, along) / 3.0;
  float v = vHag / 3.2;
  float fu = fract(u);
  float fv = fract(v);
  // soft edges, so that the pattern does not flicker from far up
  float eu = fwidth(u) * 1.2 + 0.001;
  float ev = fwidth(v) * 1.2 + 0.001;
  float far = clamp(1.0 - max(eu, ev) * 2.2, 0.0, 1.0);
  float isDoorBay = step(mod(floor(u), 4.0), 0.5) * step(v, 1.0);
  float win = smoothstep(0.2 - eu, 0.2 + eu, fu) * (1.0 - smoothstep(0.74 - eu, 0.74 + eu, fu))
            * smoothstep(0.3 - ev, 0.3 + ev, fv) * (1.0 - smoothstep(0.8 - ev, 0.8 + ev, fv));
  float door = smoothstep(0.28 - eu, 0.28 + eu, fu) * (1.0 - smoothstep(0.7 - eu, 0.7 + eu, fu))
             * (1.0 - smoothstep(0.72 - ev, 0.72 + ev, fv));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.17, 0.23), win * (1.0 - isDoorBay) * 0.8 * far);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.17, 0.1), door * isDoorBay * 0.9 * far);
}`,
      );
  };
  mat.needsUpdate = true;
}
