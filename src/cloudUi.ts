/**
 * What the player sees of saving and rooms (`cloud.ts`): a line on the start screen to save the
 * game under a name, and on a run's result a room for up to eight players.
 */

import { ROOM_SIZE, cleanName, deviceLink, roomCreate, roomGet, roomSubmit, savedName, savingOn, startSaving, stopSaving, type Room } from './cloud';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function hand(text: string, url: string): Promise<'shared' | 'copied' | 'shown'> {
  try {
    if (document.body.classList.contains('touch') && navigator.share) {
      await navigator.share({ text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'shown';
  }
}

/** The line on the start screen: save the game under a name, carry it to another device, stop. */
export function wireCloud(box: HTMLElement, home: string, suggested: () => string): void {
  box.hidden = false;
  const draw = (note = ''): void => {
    if (!savingOn()) {
      box.innerHTML =
        '<form id="cloud-form"><input type="text" maxlength="16" placeholder="Your name" autocomplete="off" required /><button>Save my game online</button></form>' +
        `<p class="small" id="cloud-note" aria-live="polite">${esc(note) || 'Optional. With a name, your game is kept online so you can go on with it on another device. No email, no password. Without a name nothing is sent.'}</p>`;
      const form = box.querySelector<HTMLFormElement>('#cloud-form')!;
      const input = form.querySelector('input')!;
      input.value = suggested();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = cleanName(input.value);
        if (!name) return;
        form.querySelector('button')!.disabled = true;
        draw((await startSaving(name)) ? '' : 'That didn’t go through. Please try again in a moment.');
      });
      return;
    }
    box.innerHTML =
      `<p class="small">Your game is saved online as <b>${esc(savedName())}</b>.</p>` +
      '<div class="row"><button type="button" id="cloud-link">Go on with it on another device</button><button type="button" id="cloud-stop">Stop saving and delete it</button></div>' +
      `<p class="small" id="cloud-note" aria-live="polite">${esc(note)}</p><input id="cloud-url" type="text" readonly hidden aria-label="Link to your saved game" />`;
    const say = (t: string): void => {
      box.querySelector('#cloud-note')!.textContent = t;
    };
    box.querySelector('#cloud-link')!.addEventListener('click', async () => {
      const url = deviceLink(home);
      const how = await hand('My 3DA game', url);
      const field = box.querySelector<HTMLInputElement>('#cloud-url')!;
      field.value = url;
      field.hidden = how !== 'shown';
      if (how === 'shown') field.select();
      say(`${how === 'copied' ? 'Link copied. ' : how === 'shown' ? 'Copy this link. ' : ''}Open it on the other device. It is the key to your game: keep it to yourself.`);
    });
    let sure = false;
    box.querySelector('#cloud-stop')!.addEventListener('click', async (e) => {
      if (!sure) {
        sure = true;
        (e.target as HTMLButtonElement).textContent = 'Yes, delete the online copy';
        say('The game on this device stays. The online copy and your results in rooms are deleted.');
        return;
      }
      draw((await stopSaving()) ? 'The online copy is deleted.' : 'That didn’t go through. Please try again in a moment.');
    });
  };
  draw();
}

// Rooms -------------------------------------------------------------------------------------------

/** A run that has just ended, as a room needs it. */
export interface RunNow {
  /** the text a challenge link carries after `c=` */
  course: string;
  place: string;
  score: number;
  seconds: number;
  /** where the run starts, as the link's ending: `#52.52000,13.40500` */
  hash: string;
}

/** The room this visit came by (`?room=<id>`), if any. */
const cameBy = ((): string => {
  const id = new URLSearchParams(location.search).get('room') ?? '';
  return /^[0-9a-f]{12}$/.test(id) ? id : '';
})();

export interface RoomUi {
  /** Call when a result is shown: with the run that just ended, and whether it is the run a link sent. */
  after(run: RunNow | null, sent: boolean): void;
}

export function wireRoom(els: { box: HTMLElement; button: HTMLButtonElement; note: HTMLElement; link: HTMLInputElement; board: HTMLElement }, home: string, typedName: () => string, fmt: (score: number, seconds: number) => string): RoomUi {
  let run: RunNow | null = null;
  let room = '';

  const draw = (r: Room | null): void => {
    els.board.replaceChildren();
    if (!r) return;
    for (const x of r.results) {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.textContent = x.name;
      const what = document.createElement('b');
      what.textContent = fmt(x.score, x.seconds);
      li.append(who, what);
      els.board.append(li);
    }
  };

  const enter = async (id: string): Promise<void> => {
    if (!run) return;
    try {
      const r = await roomSubmit(id, run.score, run.seconds);
      draw(r);
      els.button.hidden = true;
      els.note.textContent = `The room's board: ${r.results.length} of ${ROOM_SIZE} players. Each keeps their best run.`;
    } catch (err) {
      const full = /full/.test(String(err));
      els.note.textContent = full ? `This room is full: ${ROOM_SIZE} players are in. Its board is below.` : 'Your result didn’t reach the room. Please try again in a moment.';
      if (full) {
        els.button.hidden = true;
        draw(await roomGet(id).catch(() => null));
      }
    }
  };

  els.button.addEventListener('click', async () => {
    if (!run) return;
    const name = savedName() || cleanName(typedName());
    if (!name) {
      els.note.textContent = 'Enter your name above first: it is what the others in the room see.';
      return;
    }
    els.button.disabled = true;
    try {
      if (!savingOn() && !(await startSaving(name))) throw new Error('not saved');
      if (!room) {
        room = await roomCreate(run.course, run.place);
        const url = `${home}?room=${room}&c=${run.course}${run.hash}`;
        const how = await hand(`Join my room in ${run.place}: up to ${ROOM_SIZE} of us, same deliveries.`, url);
        els.link.value = url;
        els.link.hidden = false;
        if (how === 'shown') els.link.select();
      }
      await enter(room);
    } catch {
      els.note.textContent = 'That didn’t go through. Please try again in a moment.';
    }
    els.button.disabled = false;
  });
  els.link.addEventListener('focus', () => els.link.select());

  return {
    after(now, sent) {
      run = now;
      els.box.hidden = !now;
      els.link.hidden = true;
      els.button.hidden = false;
      draw(null);
      if (!now) return;
      room = sent ? cameBy : '';
      if (room && savingOn()) {
        els.note.textContent = 'Putting your result on the room’s board…';
        void enter(room);
      } else if (room) {
        els.button.textContent = 'Join the room’s board';
        els.note.textContent = 'You played a room’s run. Enter your name above to put your result on its board. That also keeps your game online under that name; you can delete it on the start screen.';
        void roomGet(room).then(draw, () => undefined);
      } else {
        els.button.textContent = `Make a room for up to ${ROOM_SIZE} players`;
        els.note.textContent = 'One link for a group: everyone plays these deliveries and sees the others’ results. It keeps your game online under your name; you can delete it on the start screen.';
      }
    },
  };
}
