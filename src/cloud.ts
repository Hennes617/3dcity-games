/**
 * Saving a game on a server, and rooms where up to eight players compare one run. Both are for a
 * player who has entered a name; without one the game plays exactly as before and none of this
 * contacts anyone.
 *
 * There is no account, no email and no password. When a player turns saving on, the browser makes
 * a long random save code and keeps it. The saved game on the server belongs to whoever holds
 * that code (the server keeps only a fingerprint of it). A link with the code in it carries the
 * game to another device; anyone given that link has the game, so it is for the player alone.
 *
 * What is saved is what the game already keeps in this browser: cash, deliveries, the scoreboard,
 * settings, and what add-ons keep. In a room the name, score and time of a run are shown to the
 * others who have the room's link. Scores come from the player's browser as they are.
 */

const API = 'https://lecaoamodyjubwuvhpcq.supabase.co/rest/v1/rpc/';
// the store's publishable key: meant to be public; what it allows is only the functions called here
const KEY = 'sb_publishable__R5VVIzkFXK-ozBm18IYjg_UTw7guWe';

const CODE = '3da-save-code';
const NAME = '3da-save-name';
const STAMP = '3da-save-at';
/** Never sent: the save code itself, when it was last sent, and a tester's private key. */
const PRIVATE = new Set([CODE, STAMP, '3da-full-key']);
const LIMIT = 60000;

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null): void => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* no store: saving cannot be turned on in this window */
  }
};

async function call<T>(fn: string, args: Record<string, unknown>, leaving = false, wait = 12000): Promise<T> {
  const res = await fetch(API + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
    keepalive: leaving,
    ...(leaving ? {} : { signal: AbortSignal.timeout(wait) }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `error ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** The name the player saves and joins rooms under, or '' when saving is off. */
export const savedName = (): string => (get(CODE) ? (get(NAME) ?? '') : '');
export const savingOn = (): boolean => !!get(CODE) && !!get(NAME);

/** A name as the server takes it: 1 to 16 characters. */
export const cleanName = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let s = '';
  for (const b of bytes) s += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62];
  return s;
}

/** Everything the game keeps in this browser, apart from what must stay here. */
function gather(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if ((k.startsWith('3da-') || k === 'drive-it-3d') && !PRIVATE.has(k)) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* nothing to gather */
  }
  return out;
}

let last = '';

/** Send the game as it is now. Does nothing when saving is off or nothing changed. */
export async function push(leaving = false): Promise<boolean> {
  const code = get(CODE);
  const name = get(NAME);
  if (!code || !name) return false;
  const data = gather();
  const text = JSON.stringify(data);
  if (text === last) return true;
  if (text.length > LIMIT) return false;
  try {
    const at = await call<string>('save_put', { code, name, data }, leaving);
    last = text;
    if (at) set(STAMP, at);
    return true;
  } catch {
    return false;
  }
}

let timer = 0;
/** The game changed: send it soon. Cheap to call often. */
export function changed(): void {
  if (!savingOn()) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void push(), 5000);
}

/** Turn saving on under this name. Resolves to whether the first save went through. */
export async function startSaving(name: string): Promise<boolean> {
  const clean = cleanName(name);
  if (!clean) return false;
  if (!get(CODE)) set(CODE, newCode());
  set(NAME, clean);
  if (!get(CODE)) return false;
  last = '';
  return push();
}

/** Fetch the saved game and put it in place of this browser's. Resolves to whether there was one. */
async function pull(code: string): Promise<boolean> {
  const got = await call<{ name: string; data: Record<string, string>; updated_at: string } | null>('save_get', { code });
  if (!got) return false;
  for (const [k, v] of Object.entries(got.data ?? {})) if ((k.startsWith('3da-') || k === 'drive-it-3d') && !PRIVATE.has(k) && typeof v === 'string') set(k, v);
  set(NAME, got.name);
  set(STAMP, got.updated_at);
  return true;
}

/** The link that carries this game to another device. It is the key to the save: for the player alone. */
export function deviceLink(home: string): string {
  return `${home}?save=${get(CODE) ?? ''}`;
}

/** Stop saving and take the saved game, and the player's results in rooms, off the server. */
export async function stopSaving(): Promise<boolean> {
  const code = get(CODE);
  if (!code) return true;
  try {
    await call('save_delete', { code });
  } catch {
    return false;
  }
  set(CODE, null);
  set(NAME, null);
  set(STAMP, null);
  return true;
}

/**
 * At the start of a visit. A link from another device (`?save=<code>`) brings its game here; a
 * browser that saves checks whether another device has played since. Resolves to 'reload' when
 * the game in this browser was replaced and the page should start again.
 */
export async function arrive(): Promise<'reload' | 'ok'> {
  const q = new URLSearchParams(location.search);
  const given = q.get('save');
  if (given !== null) {
    // out of the address at once, so that it does not travel in a link someone copies
    q.delete('save');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (/^[A-Za-z0-9]{32,64}$/.test(given) && given !== get(CODE)) {
      try {
        if (await pull(given)) {
          set(CODE, given);
          return 'reload';
        }
      } catch {
        /* the game here stays as it is */
      }
    }
    return 'ok';
  }
  const code = get(CODE);
  if (!code || !get(NAME)) return 'ok';
  try {
    // the game must not wait long for this: an invited player's run starts at once
    const got = await call<{ updated_at: string } | null>('save_get', { code }, false, 2500);
    if (got && got.updated_at !== get(STAMP) && Date.parse(got.updated_at) > Date.parse(get(STAMP) ?? '1970-01-01')) return (await pull(code)) ? 'reload' : 'ok';
  } catch {
    /* offline: play on with what is here */
  }
  return 'ok';
}

// Rooms -------------------------------------------------------------------------------------------

export interface RoomResult {
  name: string;
  score: number;
  seconds: number;
}
export interface Room {
  id: string;
  /** the same text a challenge link carries after `c=` */
  course: string;
  place: string;
  results: RoomResult[];
}

export const ROOM_SIZE = 8;

/** Make a room for this run. Needs saving to be on. Resolves to the room's id, for `?room=<id>`. */
export async function roomCreate(course: string, place: string): Promise<string> {
  return call<string>('room_create', { code: get(CODE), course, place });
}

/** The room and its board, best first, or null when there is no such room. */
export async function roomGet(id: string): Promise<Room | null> {
  return /^[0-9a-f]{12}$/.test(id) ? call<Room | null>('room_get', { room: id }) : null;
}

/** Put the player's result in the room. Rejects with 'room is full' when eight others are in. */
export async function roomSubmit(id: string, score: number, seconds: number): Promise<Room> {
  return call<Room>('room_submit', { room: id, code: get(CODE), name: get(NAME), score: Math.round(score), seconds: Math.round(seconds) });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void push(true);
  });
}
