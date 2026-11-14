/** The page a sign-in link opens: it keeps the sign-in in this browser and points back to the game. */
import { accountOn, client, signedInAs } from './account';

const say = (text: string): void => {
  document.getElementById('note')!.textContent = text;
};

void (async () => {
  if (!accountOn) return say('Accounts are not open yet.');
  const failed = new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (failed) return say(`That link did not work (${failed.replace(/\+/g, ' ')}). Ask for a new one on the game's start screen.`);
  await client(); // reads the sign-in out of the link
  const email = await signedInAs();
  if (!email) return say('You are not signed in. Ask for a sign-in link on the game’s start screen.');
  history.replaceState(null, '', location.pathname);
  say(`You are signed in as ${email}.`);
  document.getElementById('play')!.hidden = false;
})();
