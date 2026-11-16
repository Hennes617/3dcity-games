/**
 * Where am I? The player is put down in a well-known city with its name kept back, drives around,
 * and picks the city from four names. The sooner the pick, the more points; a wrong pick costs
 * points and takes that name away.
 *
 * The three wrong names are not any three: two are cities near the right one, so that knowing the
 * continent is not enough, and one is from anywhere.
 */

import type { LngLat } from './geo/projection';
import { CITY_LIST } from './places';

export interface Round {
  city: string;
  at: LngLat;
  /** the four names to pick from, the right one among them */
  options: string[];
}

/** points for a pick at once, what a second of looking and a wrong pick cost, and the least a right pick is worth */
const FULL = 1000;
const PER_SECOND = 4;
const WRONG = 250;
const LEAST = 100;
/** the start lies up to this far from the city's middle (m), so a city is not the same streets every time */
const AROUND_M = 350;
const SEEN = '3da-guess-seen';

export function points(seconds: number, wrong: number): number {
  return Math.max(LEAST, Math.round(FULL - PER_SECOND * seconds) - WRONG * wrong);
}

function seen(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SEEN) ?? '[]');
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** A city played is not given again until the others have had their turn. */
export function played(city: string): void {
  try {
    const list = seen().filter((n) => n !== city);
    list.push(city);
    localStorage.setItem(SEEN, JSON.stringify(list.slice(-(CITY_LIST.length - 8))));
  } catch {
    /* without a store a city may come twice */
  }
}

const km = (a: LngLat, b: LngLat): number => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));

function shuffle<T>(list: T[], rnd: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** A city to guess and the names to pick from. `not`: cities that would not load this time. */
export function newRound(not: string[] = [], rnd: () => number = Math.random): Round {
  const skip = new Set([...seen(), ...not]);
  let pool = CITY_LIST.filter((c) => !skip.has(c.name));
  if (!pool.length) pool = CITY_LIST.filter((c) => !not.includes(c.name));
  if (!pool.length) pool = CITY_LIST;
  const city = pool[Math.floor(rnd() * pool.length)];
  const others = CITY_LIST.filter((c) => c !== city).sort((a, b) => km(a.at, city.at) - km(b.at, city.at));
  const near = shuffle(others.slice(0, 7), rnd).slice(0, 2);
  const rest = others.filter((c) => !near.includes(c));
  const far = rest[Math.floor(rnd() * rest.length)];
  const turn = rnd() * Math.PI * 2;
  const out = Math.sqrt(rnd()) * AROUND_M;
  const at = {
    lat: city.at.lat + (Math.cos(turn) * out) / 111320,
    lon: city.at.lon + (Math.sin(turn) * out) / (111320 * Math.cos((city.at.lat * Math.PI) / 180)),
  };
  return { city: city.name, at, options: shuffle([city.name, near[0].name, near[1].name, far.name], rnd) };
}
