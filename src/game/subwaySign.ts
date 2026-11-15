/**
 * A subway entrance as it looks from above: a stairwell going down into the ground, a low wall on
 * three sides, and a sign on a post at the open end.
 *
 * The stairwell is a picture, not a hole: steps that grow darker towards the far end read as going
 * down. The sign is the game's own: a white letter on a blue disc. The letter follows what such
 * signs carry in that part of the world, "U" in Germany and Austria and "M" elsewhere. No
 * operator's own symbol is drawn.
 */

import { BoxGeometry, CanvasTexture, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

/** the stairwell on the ground: width and length (m) */
const WELL_W = 3.4;
const WELL_L = 7;
const WALL_H = 1.1;
const SIGN_UP = 3.4;
const SIGN_R = 1.7;

/** "U" where the signs say U-Bahn, "M" elsewhere. Rough boxes: Germany and Austria, without Bohemia. */
export function subwayLetter(lat: number, lon: number): 'U' | 'M' {
  const germany = lat > 47.3 && lat < 55.1 && lon > 5.9 && lon < 15;
  const austria = lat > 46.4 && lat < 49 && lon > 9.5 && lon < 17.2;
  const bohemia = lon > 12.2 && lat > 48.6 && lat < 50.75;
  return (germany || austria) && !bohemia ? 'U' : 'M';
}

const icons = new Map<string, HTMLCanvasElement>();

/** The sign: a white letter on a blue disc with a dark rim. Also drawn on the maps. */
export function subwayIcon(letter: 'U' | 'M'): HTMLCanvasElement {
  const had = icons.get(letter);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fillStyle = '#16181c';
  g.fill();
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fillStyle = '#1f6fd6';
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '900 78px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 69);
  icons.set(letter, c);
  return c;
}

let stairs: CanvasTexture | null = null;

/** Steps seen from above: light at the top of the stairs, dark at the bottom. */
function stairsTexture(): CanvasTexture {
  if (stairs) return stairs;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const steps = 11;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const v = Math.round(168 - t * 140);
    g.fillStyle = `rgb(${v},${v},${Math.round(v * 1.06)})`;
    g.fillRect(0, (i * c.height) / steps, c.width, c.height / steps + 1);
    // the edge of each step
    g.fillStyle = `rgba(0,0,0,${0.25 + t * 0.2})`;
    g.fillRect(0, (i * c.height) / steps, c.width, 2);
  }
  stairs = new CanvasTexture(c);
  stairs.colorSpace = SRGBColorSpace;
  return stairs;
}

const wallMat = new MeshStandardMaterial({ color: '#8d9198', roughness: 0.8 });
const postMat = new MeshStandardMaterial({ color: '#3a3e45', roughness: 0.7 });
const box = new BoxGeometry(1, 1, 1);
const signMats = new Map<string, MeshBasicMaterial>();
let wellMat: MeshBasicMaterial | null = null;

/**
 * One entrance. `heading` is the direction of the street beside it (radians, east = 0, north = π/2):
 * the stairs run along it. The group stands at the ground; put it where the entrance is.
 */
export function subwayEntrance(letter: 'U' | 'M', heading: number): Group {
  const g = new Group();
  wellMat ??= new MeshBasicMaterial({ map: stairsTexture() });
  const well = new Mesh(new PlaneGeometry(WELL_W, WELL_L), wellMat);
  well.rotation.x = -Math.PI / 2;
  well.position.y = 0.12;
  g.add(well);
  const wall = (sx: number, sz: number, x: number, z: number) => {
    const m = new Mesh(box, wallMat);
    m.scale.set(sx, WALL_H, sz);
    m.position.set(x, WALL_H / 2, z);
    m.castShadow = true;
    g.add(m);
  };
  // the two long sides and the deep end; the top of the stairs stays open
  wall(0.3, WELL_L, -WELL_W / 2 - 0.15, 0);
  wall(0.3, WELL_L, WELL_W / 2 + 0.15, 0);
  wall(WELL_W + 0.6, 0.3, 0, WELL_L / 2 + 0.15);
  // the sign: a post beside the open end, and the disc lying flat on top, to be read from above
  const post = new Mesh(box, postMat);
  post.scale.set(0.22, SIGN_UP, 0.22);
  post.position.set(WELL_W / 2 + 1.2, SIGN_UP / 2, -WELL_L / 2 - 0.6);
  post.castShadow = true;
  g.add(post);
  let mat = signMats.get(letter);
  if (!mat) {
    const map = new CanvasTexture(subwayIcon(letter));
    map.colorSpace = SRGBColorSpace;
    signMats.set(letter, (mat = new MeshBasicMaterial({ map, transparent: true, side: DoubleSide })));
  }
  const disc = new Mesh(new CircleGeometry(SIGN_R, 28), mat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(post.position.x, SIGN_UP + 0.05, post.position.z);
  g.add(disc);
  // the plane's long side lies along scene z; a heading of 0 (east) is scene x
  g.rotation.y = heading - Math.PI / 2;
  // the letter stays upright on the screen however the stairs lie
  disc.rotation.z = -g.rotation.y;
  return g;
}
