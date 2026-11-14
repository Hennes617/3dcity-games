/**
 * The list of people who want to hear when a full version of 3DA is ready: an email address and,
 * if they like, their city. It is the test of whether anyone would pay, before anything paid is
 * built.
 *
 * Nothing is sent anywhere until the build is told where the list is kept (`VITE_WAITLIST_URL`,
 * and `VITE_WAITLIST_KEY` where the store wants one). Without that the game shows no trace of it.
 * An address is only ever sent when its owner types it and presses the button.
 */

const URL_ = (import.meta.env.VITE_WAITLIST_URL as string | undefined) ?? '';
const KEY = (import.meta.env.VITE_WAITLIST_KEY as string | undefined) ?? '';

/** `?waitlist=preview` shows the form without a list behind it, to look at; nothing is sent. */
const PREVIEW = new URLSearchParams(location.search).get('waitlist') === 'preview';

export const waitlistOn = !!URL_ || PREVIEW;

const FROM = '3da-from';

/**
 * Where the visitor came from, when the link said so (`?ref=…` or `?utm_source=…`, as an ad's link
 * does). Kept for this visit only and sent along with a sign-up, never on its own: it changes
 * nothing in the game and makes no request.
 */
export function cameFrom(): string {
  const q = new URLSearchParams(location.search);
  const said = (q.get('ref') ?? q.get('utm_source') ?? '').replace(/[^\w.-]/g, '').slice(0, 40);
  try {
    if (said) sessionStorage.setItem(FROM, said);
    return said || (sessionStorage.getItem(FROM) ?? '');
  } catch {
    return said;
  }
}
cameFrom();

export const validEmail = (s: string): boolean => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s);

/** Put an address on the list. Resolves to whether it was taken. */
export async function joinWaitlist(email: string, city: string): Promise<boolean> {
  if (!validEmail(email)) return false;
  if (!URL_) return PREVIEW;
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(KEY ? { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=minimal' } : {}) },
      body: JSON.stringify({ email: email.trim().slice(0, 254), city: city.trim().slice(0, 60), source: cameFrom() }),
      signal: AbortSignal.timeout(10000),
    });
    // the same address a second time is fine by us
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}

/** Wire up a sign-up form: an email field, a city field, a button and a line for what happened. */
export function wireWaitlist(form: HTMLFormElement, note: HTMLElement, city: () => string): void {
  const email = form.querySelector<HTMLInputElement>('input[type=email]')!;
  const town = form.querySelector<HTMLInputElement>('input[name=city]')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  form.addEventListener('focusin', () => {
    if (!town.value) town.value = city();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validEmail(email.value)) {
      note.textContent = 'That doesn’t look like an email address.';
      return;
    }
    button.disabled = true;
    note.textContent = 'Sending…';
    const ok = await joinWaitlist(email.value, town.value);
    button.disabled = false;
    if (!ok) {
      note.textContent = 'That didn’t go through. Please try again in a moment.';
      return;
    }
    form.hidden = true;
    note.textContent = URL_ ? 'You’re on the list. One email when it’s ready, and nothing else.' : 'Preview: this is what a visitor would see. Nothing was sent.';
  });
}
