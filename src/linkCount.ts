/**
 * A tally of challenge links: how many were made and how many were opened. It is the one thing
 * the game ever counts, and it counts only for a link whose sender ticked the box beside the
 * button. Such a link carries `n=1`; a link without it is never counted, made or opened.
 *
 * What is sent is the single word "made" or "opened". Not the link, not a name, not a place. The
 * tally is two numbers a day. Like any request, it reaches the server from the sender's internet
 * address, which the tally does not keep.
 */

const TALLY = 'https://lecaoamodyjubwuvhpcq.supabase.co/rest/v1/rpc/count_link';
// the store's publishable key: meant to be public, it lets a browser add one to the tally and nothing else
const KEY = 'sb_publishable__R5VVIzkFXK-ozBm18IYjg_UTw7guWe';

const AGREED = '3da-count-links';
const SEEN = '3da-counted';

/** Whether the player ticked the box the last time. Unticked until they tick it. */
export function countAgreed(): boolean {
  try {
    return localStorage.getItem(AGREED) === '1';
  } catch {
    return false;
  }
}

export function setCountAgreed(yes: boolean): void {
  try {
    if (yes) localStorage.setItem(AGREED, '1');
    else localStorage.removeItem(AGREED);
  } catch {
    /* no store: the box then starts unticked each visit */
  }
}

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

/** A link was made, and its sender agreed to the tally. Once for each different link. */
export function countMade(code: string): void {
  if (once(`m:${code}`)) count('made');
}

/** A link was opened. Counted only when the link says its sender agreed, and once per browser. */
export function countOpened(code: string, query: URLSearchParams): void {
  if (query.get('n') === '1' && once(`o:${code}`)) count('opened');
}

/** True the first time this browser meets this link, so that a reload does not count twice. */
function once(what: string): boolean {
  // a short fingerprint of the link is kept, not the link
  let h = 0;
  for (let i = 0; i < what.length; i++) h = (h * 31 + what.charCodeAt(i)) | 0;
  const mark = h.toString(36);
  try {
    const seen = (localStorage.getItem(SEEN) ?? '').split(' ').filter(Boolean);
    if (seen.includes(mark)) return false;
    localStorage.setItem(SEEN, [...seen, mark].slice(-200).join(' '));
  } catch {
    /* no store: count it */
  }
  return true;
}
