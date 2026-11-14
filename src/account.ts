/**
 * Sign-in for players of the full version. The free game never needs it and never asks.
 *
 * Nothing here is shown until the build is told where accounts are kept (`VITE_ACCOUNT_URL`, the
 * project's address, and `VITE_ACCOUNT_KEY`, its publishable key). `?account=preview` shows the
 * control with nothing behind it, to look at.
 *
 * A free player's browser makes no request for any of this: the code that talks to the account
 * service is fetched only after a press on "Sign in", or when this browser already holds a
 * sign-in from an earlier visit.
 *
 * Signing in is a link sent to an email address; there is no password. The link opens the page
 * `account/`, which keeps the sign-in in this browser and sends the player back to the game.
 * A signed-in account that may have the full version is handed its extra features by the server
 * (see `fetchAddon`); the game loads them through `loadAddon`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAddon } from './addon';

const URL_ = ((import.meta.env.VITE_ACCOUNT_URL as string | undefined) ?? '').replace(/\/+$/, '');
const KEY = (import.meta.env.VITE_ACCOUNT_KEY as string | undefined) ?? '';
const PREVIEW = new URLSearchParams(location.search).get('account') === 'preview';

export const accountOn = (!!URL_ && !!KEY) || PREVIEW;

/** Where this browser keeps a sign-in. Its presence is the only thing looked at before any request. */
const STORE = '3da-account';

function remembered(): boolean {
  try {
    return localStorage.getItem(STORE) !== null;
  } catch {
    return false;
  }
}

let made: Promise<SupabaseClient> | null = null;

/** The account service's client, fetched on first use and not before. */
export function client(): Promise<SupabaseClient> {
  made ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_, KEY, { auth: { storageKey: STORE, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  );
  return made;
}

/** Send the sign-in link. Resolves to whether it was sent. */
export async function sendLink(email: string): Promise<boolean> {
  if (!URL_) return PREVIEW;
  try {
    const back = new URL('./account/', document.baseURI.replace(/account\/?$/, '')).href;
    const { error } = await (await client()).auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: back } });
    return !error;
  } catch {
    return false;
  }
}

/** The address signed in with in this browser, or '' when there is none. */
export async function signedInAs(): Promise<string> {
  if (!URL_) return '';
  try {
    const { data } = await (await client()).auth.getSession();
    return data.session?.user.email ?? '';
  } catch {
    return '';
  }
}

export async function signOut(): Promise<void> {
  try {
    await (await client()).auth.signOut();
  } catch {
    // signed out here or not, the stored sign-in goes
  }
  try {
    localStorage.removeItem(STORE);
  } catch {
    // nothing to remove
  }
}

/**
 * Ask the server for this account's extra features. It answers with the add-on file itself when
 * the account may have one (paid, or the owner's test account) and refuses otherwise.
 * Resolves to 'full', 'free' (signed in, nothing bought) or 'error'.
 */
async function fetchAddon(): Promise<'full' | 'free' | 'error'> {
  try {
    const { data } = await (await client()).auth.getSession();
    const token = data.session?.access_token;
    if (!token) return 'free';
    const res = await fetch(`${URL_}/functions/v1/addon`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (res.status === 403) return 'free';
    if (!res.ok) return 'error';
    const file = new Blob([await res.text()], { type: 'text/javascript' });
    await loadAddon(URL.createObjectURL(file));
    return 'full';
  } catch {
    return 'error';
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Put the sign-in control into its place on the start screen. */
export function wireAccount(box: HTMLElement): void {
  if (!accountOn) return;
  box.hidden = false;

  const signedOut = (): void => {
    box.innerHTML =
      '<button type="button" class="link" id="account-open">Sign in</button> <span class="small">for players of the full version. The free game needs no account.</span>' +
      '<form id="account-form" hidden><input type="email" placeholder="Your email address" autocomplete="email" required /><button>Send me a sign-in link</button></form>' +
      '<p class="small" id="account-note" aria-live="polite"></p>';
    const form = box.querySelector<HTMLFormElement>('#account-form')!;
    const note = box.querySelector<HTMLElement>('#account-note')!;
    const email = form.querySelector('input')!;
    const button = form.querySelector('button')!;
    box.querySelector('#account-open')!.addEventListener('click', () => {
      form.hidden = false;
      email.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      note.textContent = 'Sending…';
      const ok = await sendLink(email.value);
      button.disabled = false;
      if (!ok) {
        note.textContent = 'That didn’t go through. Please try again in a moment.';
        return;
      }
      form.hidden = true;
      note.textContent = URL_ ? 'Look in your email: the link in it signs you in. No password needed.' : 'Preview: this is what a player would see. Nothing was sent.';
    });
  };

  const signedIn = (email: string, state: 'full' | 'free' | 'error' | 'wait'): void => {
    const what = { full: 'Full version on.', free: 'No full version on this account yet.', error: 'The full version could not be loaded just now. Reload to try again.', wait: 'Loading…' }[state];
    box.innerHTML = `<span class="small">Signed in as ${esc(email)}. ${what}</span> <button type="button" class="link" id="account-out">Sign out</button>`;
    box.querySelector('#account-out')!.addEventListener('click', async () => {
      await signOut();
      // the extra features stay until the page is loaded again
      location.reload();
    });
  };

  signedOut();
  // only a browser that signed in before talks to the account service without being asked
  if (!URL_ || !remembered()) return;
  void (async () => {
    const email = await signedInAs();
    if (!email) return;
    signedIn(email, 'wait');
    signedIn(email, await fetchAddon());
  })();
}
