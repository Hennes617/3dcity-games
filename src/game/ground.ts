/**
 * Calms the ground heights before the town is built on them.
 *
 * The height data is measured from above. Where a town is dense and tall it measured roofs, not
 * streets: the "ground" between high-rises then bulges up by tens of metres and swallows the
 * smaller houses, and over the sea it can be anything. For a game played on the streets:
 *
 * - **The sea is at sea level**, wherever the map says there is sea.
 * - **What the buildings added is taken off.** From the map's footprints and heights the game works
 *   out how much roof the data would have seen at each spot. It then asks the data itself whether
 *   that lift is in it (some regions' data is of the bare ground already), and takes off as much
 *   as it finds: none, part, or all.
 * - **Built-up ground loses its bulges.** Around buildings, every bump narrower than about 155 m
 *   is taken down to the level of the ground around it. A slope stays a slope and a hill wider
 *   than that stays a hill; only narrow tops are trimmed.
 */

import type { Polygon } from '../geo/polygon';
import { isSea, seaMaskFromPolygons } from '../geo/sea';
import type { HeightGrid } from '../geo/terrain';

/** half the width of the bumps that go, in grid steps (10 steps of 7.8 m are about 78 m) */
const REACH = 10;
/** how far around a building the ground counts as built-up (m): wide enough to take in a beach or a square */
const NEAR_M = 120;

/** The lowest (or highest) value within `r` cells to every side: a square window, done in two passes. */
function window1(src: Float32Array, n: number, r: number, pick: (a: number, b: number) => number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let v = src[j * n + i];
      for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) v = pick(v, src[j * n + a]);
      tmp[j * n + i] = v;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let v = tmp[j * n + i];
      for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) v = pick(v, tmp[b * n + i]);
      out[j * n + i] = v;
    }
  }
  return out;
}

/** Changes `grid.elev` in place. Returns how many grid points were lowered and by how much at most. */
export function calmGround(grid: HeightGrid, buildings: Array<{ poly: Polygon; height: number }>, sea: Polygon[] | undefined): { lowered: number; most: number; share: number } {
  const { n, sizeM, elev } = grid;
  const step = sizeM / (n - 1);
  const h = sizeM / 2;

  // the sea at sea level
  const mask = sea?.length ? seaMaskFromPolygons(sea, sizeM, 1024) : null;
  const wet = new Uint8Array(elev.length);
  if (mask) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!isSea(mask, -h + i * step, -h + j * step)) continue;
        wet[j * n + i] = 1;
        elev[j * n + i] = 0;
      }
    }
  }

  // which grid points lie at buildings
  const built = new Uint8Array(elev.length);
  // and how tall the tallest building near each grid point is (m)
  const tall = new Float32Array(elev.length);
  for (const b of buildings) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of b.poly.outer) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const i0 = Math.max(0, Math.floor((x0 - NEAR_M + h) / step));
    const i1 = Math.min(n - 1, Math.ceil((x1 + NEAR_M + h) / step));
    const j0 = Math.max(0, Math.floor((y0 - NEAR_M + h) / step));
    const j1 = Math.min(n - 1, Math.ceil((y1 + NEAR_M + h) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        built[j * n + i] = 1;
        if (b.height > tall[j * n + i]) tall[j * n + i] = b.height;
      }
    }
  }

  // how much roof the measurement would have seen at each grid point: the share of the ground
  // around it that is building, times how high those buildings are, evened out over about 40 m
  const roof = blur(roofSeen(buildings, n, step, h), n, 2);
  // Is that lift in the data? Compare the small ups and downs of the heights with those of the
  // roofs, where there are buildings: the share of the roof field that the heights follow.
  const hiE = minus(elev, blur(elev, n, 12));
  const hiR = minus(roof, blur(roof, n, 12));
  let sRE = 0;
  let sRR = 0;
  for (let k = 0; k < elev.length; k++) {
    if (!built[k] || wet[k]) continue;
    sRE += hiR[k] * hiE[k];
    sRR += hiR[k] * hiR[k];
  }
  const share = sRR > 0 ? Math.max(0, Math.min(1, sRE / sRR)) : 0;
  // under a fifth is chance: such data shows the bare ground
  if (share >= 0.2) for (let k = 0; k < elev.length; k++) if (!wet[k]) elev[k] -= share * roof[k];

  // the ground without its narrow bumps: the lowest around, then the highest of that around
  const opened = window1(window1(elev, n, REACH, Math.min), n, REACH, Math.max);
  let lowered = 0;
  let most = 0;
  const next = Float32Array.from(elev);
  for (let k = 0; k < elev.length; k++) {
    if (!built[k] || wet[k]) continue;
    const drop = elev[k] - opened[k];
    // under half a metre is the lie of the land, not a roof
    if (drop < 0.5) continue;
    next[k] = opened[k];
    lowered++;
    most = Math.max(most, drop);
  }
  // soften the steps the lowering left, where it happened
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = next[k];
      if (built[k] && !wet[k] && i > 0 && j > 0 && i < n - 1 && j < n - 1) {
        let s = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += next[(j + b) * n + i + a];
        v = s / 9;
      }
      elev[k] = v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  grid.min = min;
  grid.max = max;
  return { lowered, most, share };
}

/** The mean of the values within `r` cells to every side. */
function blur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) {
        s += src[j * n + a];
        c++;
      }
      tmp[j * n + i] = s / c;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) {
        s += tmp[b * n + i];
        c++;
      }
      out[j * n + i] = s / c;
    }
  }
  return out;
}

function minus(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] - b[k];
  return out;
}

/** At each grid point: the mean roof height over the ground of its cell (0 where nothing stands). */
function roofSeen(buildings: Array<{ poly: Polygon; height: number }>, n: number, step: number, h: number): Float32Array {
  const out = new Float32Array(n * n);
  // four spots to a cell
  const SUB = 2;
  const sub = step / SUB;
  for (const b of buildings) {
    const ring = b.poly.outer;
    if (ring.length < 3 || !(b.height > 0)) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const a0 = Math.max(0, Math.floor((x0 + h) / sub));
    const a1 = Math.min(n * SUB - 1, Math.ceil((x1 + h) / sub));
    const b0 = Math.max(0, Math.floor((y0 + h) / sub));
    const b1 = Math.min(n * SUB - 1, Math.ceil((y1 + h) / sub));
    for (let bj = b0; bj <= b1; bj++) {
      const y = -h + (bj + 0.5) * sub - step / 2;
      for (let ai = a0; ai <= a1; ai++) {
        const x = -h + (ai + 0.5) * sub - step / 2;
        // is the spot inside the outline?
        let inside = false;
        for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
          const [px, py] = ring[p];
          const [qx, qy] = ring[q];
          if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) inside = !inside;
        }
        if (!inside) continue;
        const i = Math.min(n - 1, Math.max(0, Math.round((x + h) / step)));
        const j = Math.min(n - 1, Math.max(0, Math.round((y + h) / step)));
        out[j * n + i] += b.height / (SUB * SUB);
      }
    }
  }
  return out;
}
