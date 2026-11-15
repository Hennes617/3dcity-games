/**
 * A tally of challenge links: how many were made and how many were opened. It is the one thing
 * the game ever counts, and the line under the challenge button says so.
 *
 * What is sent is the single word "made" or "opened". Not the link, not a name, not a place. The
 * tally is two numbers a day. Nothing is kept in the player's browser for it, so a link opened
 * twice is counted twice. Like any request, it reaches the server from the sender's internet
 * address, which the tally does not keep.
 */

const TALLY = 'https://lecaoamodyjubwuvhpcq.supabase.co/rest/v1/rpc/count_link';
// the store's publishable key: meant to be public, it lets a browser add one to the tally and nothing else
const KEY = 'sb_publishable__R5VVIzkFXK-ozBm18IYjg_UTw7guWe';

function count(kind: 'made' | 'opened'): void {
  // nothing waits for this and nothing depends on it
  void fetch(TALLY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ kind }),
    keepalive: true,
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

// for as long as the page is open: a second press on the button for the same run is the same link
const made = new Set<string>();

/** A link was made. Once for each different link while the page is open. */
export function countMade(code: string): void {
  if (made.has(code)) return;
  made.add(code);
  count('made');
}

/** The game was opened by a challenge link. */
export function countOpened(): void {
  count('opened');
}
