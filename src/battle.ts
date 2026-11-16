/**
 * A battle: two players, the same town, one package a round. Whoever brings it to the drop-off
 * wins the round; two rounds win the battle.
 *
 * The package goes to whoever reaches it first, by car. The one who has it keeps it until their
 * car blows up: then it lies at a new place and is anyone's again. So the one without it has two
 * ways to the round: wreck the other's car, or be nearer when it lands.
 *
 * Each game draws the other player's car where the other says it is and treats it as a car like
 * any other: it is solid, and a crash dents your own car in your own game. What the two games
 * must agree on (who got the package, who delivered it) the server decides (`battleNet.ts`).
 */

import type { Battle, CarState, Player } from './battleNet';
import type { Game, Course } from './game/game';
import type { Car } from './game/cars';
import type { LngLat } from './geo/projection';

export const ROUNDS_TO_WIN = 2;
const REACH_M = 6.5;
const RIVAL_PAINT = '#ff7a1a';
/** how long the other player may be gone before the battle is called off (s) */
const GONE_S = 20;

export interface BattleView {
  /** the line at the top: the score and what to do */
  status(html: string): void;
  toast(text: string, kind?: 'good' | 'bad' | 'info'): void;
  flash(text: string): void;
  sound(what: 'pickup' | 'deliver' | 'run' | 'late'): void;
  /** the battle is over: who won (null: called off), and the rounds each took */
  ended(winner: Player | null, mine: number, theirs: number, why: string): void;
  /** the battle has been started again after it ended */
  again(): void;
  /** both players go to where the battle begins; resolves when the town stands */
  toStart(along: number): Promise<void>;
}

export interface BattleRun {
  /** call every step of the game */
  tick(dt: number): void;
  /** the player who made the battle starts it again after it has ended */
  again(): void;
  stop(): void;
  readonly name: string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function runBattle(game: Game, net: Battle, course: Course, view: BattleView): BattleRun {
  const me = net.me;
  const them: Player = me === 1 ? 2 : 1;
  let theirName = '';
  const who = (): string => theirName || 'Your rival';
  let phase: 'wait' | 'count' | 'race' | 'between' | 'over' = 'wait';
  let round = 0;
  /**
   * The number the package is claimed under on the server. Every start of a round and every loss
   * of the package gives it the next one, so that each can be claimed afresh. Whoever causes the
   * change (the starter of a round, the one whose car blew up) names the number.
   */
  let key = 0;
  let wins: Record<Player, number> = { 1: 0, 2: 0 };
  let carrier: 0 | Player = 0;
  let packageAt: LngLat | null = null;
  let claiming = false;
  let goAt = 0;
  let nextAt = 0;
  let goneFor = -1;
  let stopped = false;

  // ---- the other player's car

  let last: { s: CarState; at: number } | null = null;
  let ghost: Car | null = null;
  let ring: { remove: () => void; x: number; y: number } | null = null;
  let chaseT = 0;

  const leg = (): Course['legs'][number] => course.legs[(round - 1) % course.legs.length];

  function score(): string {
    return `<b>You ${wins[me]} : ${wins[them]} ${esc(who())}</b>`;
  }

  function say(): void {
    if (phase === 'wait') view.status('Battle · waiting for the other player');
    else if (phase === 'over') view.status(score());
    else if (phase === 'count' || phase === 'between') view.status(`${score()} · round ${round}`);
    else if (carrier === 0) view.status(`${score()} · round ${round} · <span class="job">get the package</span>`);
    else if (carrier === me) view.status(`${score()} · round ${round} · <span class="drop">you have it: to the yellow ring</span>`);
    else view.status(`${score()} · round ${round} · <span class="rival">${esc(who())} has it: wreck their car</span>`);
  }

  function aim(): void {
    if (phase !== 'race' && phase !== 'count') return game.point(null);
    if (carrier === 0 && packageAt) game.point('job', packageAt);
    else if (carrier === me) game.point('drop', leg().to);
    else if (last) game.point('rival', { lat: last.s.lat, lon: last.s.lon });
  }

  function dropGhost(): void {
    if (ghost) game.remove(ghost);
    ghost = null;
    ring?.remove();
    ring = null;
  }

  function moveGhost(dt: number): void {
    if (!last || !game.world) return;
    const s = last.s;
    // where they are by now: what they sent, carried on by their speed for the time since
    const age = Math.min(0.5, (performance.now() - last.at) / 1000);
    const [bx, by] = game.world.proj.toLocal(s.lon, s.lat);
    const vx = Math.cos(s.dir) * s.v;
    const vy = Math.sin(s.dir) * s.v;
    const tx = bx + vx * age;
    const ty = by + vy * age;
    game.rivalAt = { lat: s.lat, lon: s.lon };
    const inside = Math.abs(tx) < game.world.half - 12 && Math.abs(ty) < game.world.half - 12;
    const driving = s.body.startsWith('car');
    if (!inside || !driving) {
      if (ghost) game.remove(ghost);
      ghost = null;
    }
    // on foot: a ring where they stand
    if (inside && !driving) {
      if (!ring || Math.hypot(ring.x - tx, ring.y - ty) > 1.5) {
        ring?.remove();
        ring = { ...game.ring(RIVAL_PAINT, tx, ty), x: tx, y: ty };
      }
    } else if (ring) {
      ring.remove();
      ring = null;
    }
    if (!inside || !driving) return;
    if (ghost && (ghost.gone || !game.cars.includes(ghost))) ghost = null;
    if (!ghost) {
      const kind = s.body === 'car:sport' ? 'sport' : s.body === 'car:van' || s.body === 'car:bus' ? 'van' : 'sedan';
      ghost = game.place(kind, tx, ty, s.dir, { colour: RIVAL_PAINT });
      ghost.ghost = true;
    }
    const g = ghost;
    // far off the mark (a new square, a restart): jump; otherwise ease towards it
    const off = Math.hypot(tx - g.x, ty - g.y);
    const k = off > 25 ? 1 : 1 - Math.exp(-10 * dt);
    g.x += (tx - g.x) * k;
    g.y += (ty - g.y) * k;
    let turn = s.dir - g.th;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    g.th += turn * k;
    g.vx = vx;
    g.vy = vy;
    g.hp = s.hp;
  }

  // ---- what the other side says

  net.on('car', (s) => {
    last = { s, at: performance.now() };
  });

  net.on('peer', (name) => {
    if (stopped) return;
    if (name === null) {
      if (phase !== 'wait' && phase !== 'over') {
        goneFor = 0;
        view.toast(`${who()} has dropped out of the line`, 'bad');
      }
      last = null;
      dropGhost();
      return;
    }
    theirName = name;
    goneFor = -1;
    if (phase !== 'wait') return view.toast(`${who()} is back`, 'info');
    // both here: to the start, and the one who made the battle gives the signal
    void view.toStart(me === 1 ? 0 : 14).then(() => {
      if (stopped) return;
      game.lead(true);
      say();
      if (me === 1) setTimeout(() => !stopped && net.go(1, 3000), 1200);
    });
  });

  net.on('go', (n, inMs) => {
    if (stopped) return;
    if (phase === 'over') {
      // started again
      wins = { 1: 0, 2: 0 };
      round = 0;
      view.again();
    }
    game.lead(true);
    round++;
    key = n;
    carrier = 0;
    claiming = false;
    packageAt = leg().from;
    phase = 'count';
    goAt = performance.now() + inMs;
    aim();
    say();
    view.flash(`Round ${round}`);
  });

  net.on('taken', (k, what, by) => {
    if (stopped || k !== key || phase === 'over' || phase === 'wait') return;
    // their clock was a moment ahead of ours
    if (phase === 'count') phase = 'race';
    claiming = false;
    if (what === 'pickup') {
      carrier = by;
      packageAt = null;
      view.sound('pickup');
      view.toast(by === me ? 'You have the package: get it to the yellow ring' : `${who()} has the package. Wreck their car and it is anyone's again`, by === me ? 'good' : 'bad');
    } else {
      wins[by]++;
      carrier = 0;
      const done = wins[by] >= ROUNDS_TO_WIN;
      view.sound(by === me ? (done ? 'run' : 'deliver') : 'late');
      view.flash(by === me ? `Round ${round} is yours` : `Round ${round} goes to ${who()}`);
      if (done) {
        phase = 'over';
        game.point(null);
        say();
        view.ended(by, wins[me], wins[them], '');
        return;
      }
      phase = 'between';
      nextAt = performance.now() + 3500;
    }
    aim();
    say();
  });

  net.on('lost', (k, lat, lon) => {
    if (stopped || (phase !== 'race' && phase !== 'count') || k !== key + 1) return;
    key = k;
    carrier = 0;
    claiming = false;
    packageAt = { lat, lon };
    view.toast(`${who()}'s car blew up: the package lies at a new place`, 'good');
    aim();
    say();
  });

  const before = game.onWreck;
  game.onWreck = () => {
    before();
    if (stopped || phase !== 'race' || carrier !== me) return;
    // the package is thrown clear: somewhere a road leads to, not right beside the wreck
    const [x, y] = game.pos();
    const at = game.placeNear(game.world.proj.toLngLat(x, y), 160, 380);
    key++;
    carrier = 0;
    claiming = false;
    packageAt = at;
    net.lost(key, at.lat, at.lon);
    view.toast('Your car blew up: the package lies at a new place', 'bad');
    aim();
    say();
  };

  say();

  return {
    get name() {
      return theirName;
    },
    again() {
      if (me === 1 && phase === 'over') net.go(key + 1, 3000);
    },
    stop() {
      stopped = true;
      game.onWreck = before;
      dropGhost();
      game.lead(false);
      net.leave();
    },
    tick(dt) {
      if (stopped || !game.world) return;
      const [x, y] = game.pos();
      const at = game.world.proj.toLngLat(x, y);
      const c = game.car;
      net.car({ lat: at.lat, lon: at.lon, dir: c ? c.th : game.me.th, v: c ? c.forward : 0, body: c ? `car:${c.kind}` : 'foot', hp: c ? c.hp : 100 });
      moveGhost(dt);

      const now = performance.now();
      if (goneFor >= 0 && phase !== 'over') {
        goneFor += dt;
        if (goneFor > GONE_S) {
          phase = 'over';
          game.point(null);
          say();
          view.ended(null, wins[me], wins[them], `${who()} left the battle.`);
        }
      }
      if (phase === 'count') {
        const left = Math.ceil((goAt - now) / 1000);
        if (left <= 0) {
          phase = 'race';
          view.flash('Go!');
          say();
        }
      } else if (phase === 'between') {
        if (me === 1 && now >= nextAt) {
          nextAt = Infinity;
          net.go(key + 1, 3000);
        }
      } else if (phase === 'race') {
        // the other player moves: the arrow follows, not at every step
        if (carrier === them) {
          chaseT -= dt;
          if (chaseT <= 0) {
            chaseT = 0.7;
            aim();
          }
        }
        // a package is taken, and brought, by car
        if (!claiming && c && game.ledMetres() < REACH_M && (carrier === 0 || carrier === me)) {
          claiming = true;
          const k = key;
          // refused or unreachable: try again in a moment, not at every step
          void net.claim(k, carrier === 0 ? 'pickup' : 'drop').catch(() => setTimeout(() => k === key && (claiming = false), 1500));
        }
      }
    },
  };
}
