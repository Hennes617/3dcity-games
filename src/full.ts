/** The page that says what a full version would add, with the list to join. */
import { waitlistOn, wireWaitlist } from './waitlist';

const form = document.getElementById('join') as HTMLFormElement;
if (waitlistOn) wireWaitlist(form, document.getElementById('note')!, () => '');
else {
  form.hidden = true;
  document.getElementById('off')!.hidden = false;
}
