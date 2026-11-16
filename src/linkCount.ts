/**
 * The only things the game ever counts: challenge links made, challenge links opened, and visitors
 * who arrive by the link under a video (`?ref=youtube`). Each count says which part of the map the
 * run is in, as a square of one degree, roughly 100 km across. The line under the challenge button
 * and the README say so.
 *
 * What is sent is one word ("made", "opened" or "youtube") and that square, for example "53,10".
 * Not the link, not a name, not the street or the town. The tally is a number per day, word and
 * square. Nothing is kept in the player's browser for it, so a link opened twice is counted twice.
 * Like any request, it reaches the server from the sender's internet address, which the tally does
 * not keep. Where the visitor is plays no part: the square is the place on the map being played.
 */

const TALLY = 'https://lecaoamodyjubwuvhpcq.supabase.co/rest/v1/rpc/count_link_at';
// the store's publishable key: meant to be public, it lets a browser add one to the tally and nothing else
const KEY = 'sb_publishable__R5VVIzkFXK-ozBm18IYjg_UTw7guWe';

interface Place {
  lat: number;
  lon: number;
}

/** The one-degree square a place lies in, named by its south-west corner: Hamburg is "53,9". */
export function square(at: Place): string {
  return `${Math.floor(at.lat)},${Math.floor(at.lon)}`;
}

function count(kind: 'made' | 'opened' | 'youtube', at?: Place): void {
  // nothing waits for this and nothing depends on it
  void fetch(TALLY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ kind, cell: at ? square(at) : '' }),
    keepalive: true,
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

/**
 * Links posted in public are opened by machines as well: the checkers of the site they are posted
 * on load the page, run it, and leave. They do not touch it. So an opened link and an arrival are
 * counted only once the visitor has touched, clicked or pressed a key.
 */
const person = new Promise<void>((seen) => {
  const on = (e: Event): void => {
    if (!e.isTrusted) return;
    for (const k of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(k, on, true);
    seen();
  };
  for (const k of ['pointerdown', 'keydown', 'touchstart']) addEventListener(k, on, true);
});

// for as long as the page is open: a second press on the button for the same run is the same link
const made = new Set<string>();

/** A link was made for a run that starts at this place. Once for each different link while the page is open. */
export function countMade(code: string, at: Place): void {
  if (made.has(code)) return;
  made.add(code);
  count('made', at);
}

/** The game was opened by a challenge link for a run that starts at this place. */
export function countOpened(at: Place): void {
  void person.then(() => count('opened', at));
}

let arriving = false;
let played: Place | undefined;

/**
 * The game was opened by the link under a video. It is counted once, when the visitor first
 * touches the page: with the square of the place they are playing, or without one if they have
 * not played anywhere yet.
 */
export function cameByVideo(query: URLSearchParams): void {
  if (query.get('ref') !== 'youtube') return;
  arriving = true;
  void person.then(() => {
    // a moment, so that a place chosen by this very touch is known
    setTimeout(() => {
      arriving = false;
      count('youtube', played);
    }, 4000);
  });
}

/** A place is being loaded to play in: where a visitor from the video link is counted. */
export function playingAt(at: Place): void {
  if (arriving) played = at;
}
