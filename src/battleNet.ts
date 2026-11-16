/**
 * The line between the two players of a battle. It carries where each car is, bumps, the start,
 * and who reached a package first; what the game makes of these is the game's own business.
 *
 * Nothing here runs, and nobody is contacted, until a player makes a battle or opens a battle
 * link. The code for the live connection is fetched only then.
 *
 * What is sent while a battle lasts: the place and movement of the player's car in the game and
 * the name they chose, to the other player, through the server's live channel. None of it is
 * kept. The server keeps, for a day, which run the battle is and who was first at each package;
 * the two players are known to it only by fingerprints of random tokens made for this battle.
 * The one thing both games must agree on, who got a package, is decided by the server: the first
 * claim to arrive stands.
 */

import type { RealtimeChannel } from '@supabase/realtime-js';

const HOST = 'lecaoamodyjubwuvhpcq.supabase.co';
const API = `https://${HOST}/rest/v1/rpc/`;
// the store's publishable key: meant to be public; what it allows is only what is called here
const KEY = 'sb_publishable__R5VVIzkFXK-ozBm18IYjg_UTw7guWe';

/** How often a car's place is sent, a second. The game smooths the movement in between. */
const RATE = 8;

/** Where a car is and how it moves. The game decides what the numbers mean; they are passed on as they are. */
export interface CarState {
  lat: number;
  lon: number;
  /** heading, radians */
  dir: number;
  /** speed, metres a second */
  v: number;
  /** on foot or in a car, and which kind */
  body: string;
  /** the car's health, 0 to 100 */
  hp: number;
}

/** A bump given to the other player's car. */
export interface Hit {
  /** push, metres a second, east and north */
  dx: number;
  dy: number;
  /** damage, in the game's own points */
  hurt: number;
}

export type Player = 1 | 2;
export type What = 'pickup' | 'drop';

export interface BattleEvents {
  /** the other player is here (with the name they chose, or '') or has gone (null) */
  peer: (name: string | null) => void;
  /** the other car, about RATE times a second; `at` is the sender's clock in milliseconds */
  car: (state: CarState, at: number) => void;
  /** the other player's car hit this one */
  hit: (hit: Hit) => void;
  /** a round begins in `inMs` milliseconds */
  go: (round: number, inMs: number) => void;
  /** a package or drop-off of a round has been reached, by this player */
  taken: (round: number, what: What, by: Player) => void;
  /** the other player's car blew up with the package on board: it lies at a new place, to be claimed as `key` */
  lost: (key: number, lat: number, lon: number) => void;
  /** the other player says the battle is over, with their cash */
  over: (cash: number) => void;
}

export interface Battle {
  id: string;
  /** 1 made the battle, 2 accepted it */
  me: Player;
  /** the same text a challenge link carries after `c=` */
  course: string;
  place: string;
  on<K extends keyof BattleEvents>(event: K, fn: BattleEvents[K]): void;
  /** Call every frame with the player's car; it is sent on at RATE a second. */
  car(state: CarState): void;
  hit(hit: Hit): void;
  /** Only the player who made the battle starts a round. */
  go(round: number, inMs?: number): void;
  /** "I am at the package" (or drop-off). Resolves to who was first; the other player is told. */
  claim(round: number, what: What): Promise<Player>;
  /** "My car blew up with the package": where it lies now, and the number its next pickup is claimed under. */
  lost(key: number, lat: number, lon: number): void;
  over(cash: number): void;
  leave(): void;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(API + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `error ${res.status}`);
  return (await res.json()) as T;
}

/** This browser's token for a battle: made here, kept for the visit, never shown. */
function token(id: string): string {
  const k = `3da-battle-${id}`;
  try {
    const kept = sessionStorage.getItem(k);
    if (kept) return kept;
  } catch {
    /* no store: a token for this page only */
  }
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(40))) s += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62];
  try {
    sessionStorage.setItem(k, s);
  } catch {
    /* as above */
  }
  return s;
}

/** The battle a link names (`?battle=<id>`), or ''. */
export function battleInLink(search: string): string {
  const id = new URLSearchParams(search).get('battle') ?? '';
  return /^[0-9a-f]{12}$/.test(id) ? id : '';
}

/** The link to send: it starts the same run for whoever accepts. */
export function battleLink(home: string, b: { id: string; course: string }, hash: string): string {
  return `${home}?battle=${b.id}&c=${b.course}${hash}`;
}

async function connect(id: string, me: Player, course: string, place: string, tok: string, name: string): Promise<Battle> {
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(`wss://${HOST}/realtime/v1`, { params: { apikey: KEY } });
  const channel: RealtimeChannel = client.channel(`battle:${id}`, { config: { broadcast: { self: false, ack: false }, presence: { key: String(me) } } });
  const fns: { [K in keyof BattleEvents]?: BattleEvents[K] } = {};
  const other = me === 1 ? '2' : '1';
  let here = false;

  // both players claim and both pass the answer on: the game hears of each package once
  const told = new Set<string>();
  const taken = (round: number, what: What, by: Player): void => {
    if (told.has(`${round}:${what}`)) return;
    told.add(`${round}:${what}`);
    fns.taken?.(round, what, by);
  };
  let peerName: string | null = null;
  // who else is on the line: told to the game when it changes, and once more when it starts listening
  const look = (): void => {
    const there = (channel.presenceState() as Record<string, { name?: string }[]>)[other];
    const now = !!there?.length;
    if (now === here) return;
    here = now;
    peerName = now ? String(there[0].name ?? '').slice(0, 16) : null;
    fns.peer?.(peerName);
  };

  const say = (event: string, payload: Record<string, unknown>): void => {
    void channel.send({ type: 'broadcast', event, payload });
  };

  channel
    .on('broadcast', { event: 'car' }, ({ payload }) => fns.car?.(payload.s as CarState, payload.t as number))
    .on('broadcast', { event: 'hit' }, ({ payload }) => fns.hit?.(payload as Hit))
    .on('broadcast', { event: 'go' }, ({ payload }) => fns.go?.(payload.round as number, payload.inMs as number))
    .on('broadcast', { event: 'taken' }, ({ payload }) => taken(payload.round as number, payload.what as What, payload.by as Player))
    .on('broadcast', { event: 'lost' }, ({ payload }) => fns.lost?.(payload.key as number, payload.lat as number, payload.lon as number))
    .on('broadcast', { event: 'over' }, ({ payload }) => fns.over?.(payload.cash as number))
    .on('presence', { event: 'sync' }, () => look());

  await new Promise<void>((done, fail) => {
    const t = setTimeout(() => fail(new Error('the live connection did not open')), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        void channel.track({ name: name.slice(0, 16) });
        done();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(t);
        fail(new Error('the live connection did not open'));
      }
    });
  });

  let sent = 0;
  return {
    id,
    me,
    course,
    place,
    on(event, fn) {
      fns[event] = fn;
      // the other player may have been here before the game started listening
      if (event === 'peer' && here) (fn as BattleEvents['peer'])(peerName);
    },
    car(state) {
      const now = performance.now();
      if (now - sent < 1000 / RATE) return;
      sent = now;
      // numbers are cut short: a place to about a decimetre is plenty
      say('car', { t: Date.now(), s: { lat: +state.lat.toFixed(6), lon: +state.lon.toFixed(6), dir: +state.dir.toFixed(3), v: +state.v.toFixed(2), body: state.body, hp: Math.round(state.hp) } });
    },
    hit(hit) {
      say('hit', { dx: +hit.dx.toFixed(2), dy: +hit.dy.toFixed(2), hurt: Math.round(hit.hurt) });
    },
    go(round, inMs = 3000) {
      if (me !== 1) return;
      say('go', { round, inMs });
      // the starter's own game begins by the same message
      fns.go?.(round, inMs);
    },
    async claim(round, what) {
      const by = await rpc<Player>('battle_claim', { battle: id, token: tok, round, what });
      say('taken', { round, what, by });
      taken(round, what, by);
      return by;
    },
    lost(key, lat, lon) {
      say('lost', { key, lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
    },
    over(cash) {
      say('over', { cash: Math.round(cash) });
    },
    leave() {
      void channel.unsubscribe();
      client.disconnect();
    },
  };
}

/** Make a battle for this run. Resolves once the live connection is open; the other player is announced by `peer`. */
export async function hostBattle(course: string, place: string, name = ''): Promise<Battle> {
  let tok = '';
  for (const b of crypto.getRandomValues(new Uint8Array(40))) tok += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62];
  const id = await rpc<string>('battle_create', { token: tok, course, place });
  try {
    sessionStorage.setItem(`3da-battle-${id}`, tok);
  } catch {
    /* a reload then loses the host's place in the battle */
  }
  return connect(id, 1, course, place, tok, name);
}

/** Accept a battle from a link. Resolves to null when there is no such battle (they last a day), and rejects with 'full' when two are already in. */
export async function joinBattle(id: string, name = ''): Promise<Battle | null> {
  const tok = token(id);
  const got = await rpc<{ me: 0 | 1 | 2; course: string; place: string } | null>('battle_join', { battle: id, token: tok });
  if (!got) return null;
  if (got.me === 0) throw new Error('full');
  return connect(id, got.me, got.course, got.place, tok, name);
}
