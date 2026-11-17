/**
 * Homes on screen: the offer on the result card after a run, the "for sale" panel when the player
 * stops beside a building, the marks on owned buildings, and the rent waiting on return.
 * The rules and prices are in `game/homes.ts`.
 */

import type { Game } from './game/game';
import type { World } from './game/world';
import { dayOf, homesIn, loadHomes, rentDue, rentFor, rentPerVisit, saveHomes, type Home, type Homes, type Lot } from './game/homes';
import { homePlate, inPlate, loadSaved, payFrom, storeSaved, type Plate } from './game/bank';
import { MAX_CASH } from './game/game';
import { serviceIcon } from './game/services';
import { pointInRing } from './geo/polygon';
import { countPlay } from './linkCount';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** how near a building one has to stop for its panel (m) */
const BESIDE_M = 7;
/** how near a bank one has to stop: its spot on the road, or the bank itself on foot (m) */
const BANK_ROAD_M = 9;
const BANK_M = 14;
/** how far from the end of a run an offer may lie (m) */
const OFFER_M = 500;

let homeIcon: HTMLCanvasElement | null = null;

/** A house on a yellow disc, for the roof of an owned building and the maps. */
function icon(): HTMLCanvasElement {
  if (homeIcon) return homeIcon;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fillStyle = '#16181c';
  g.fill();
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fillStyle = '#ffd400';
  g.fill();
  g.fillStyle = '#16181c';
  g.beginPath();
  g.moveTo(64, 26);
  g.lineTo(100, 60);
  g.lineTo(90, 60);
  g.lineTo(90, 98);
  g.lineTo(38, 98);
  g.lineTo(38, 60);
  g.lineTo(28, 60);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffd400';
  g.fillRect(57, 74, 14, 24);
  return (homeIcon = c);
}

function distanceTo(lot: Lot, x: number, y: number): number {
  const r = lot.poly.outer;
  if (pointInRing([x, y], r)) return 0;
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j];
    const [bx, by] = r[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/** "a 5-floor", "an 8-floor", "an 11-floor" */
const floorsA = (n: number) => `${/^(8|11|18)$|^8\d$/.test(String(n)) ? 'an' : 'a'} ${n}-floor`;
const on = (street: string) => (street ? ` on ${street}` : '');

/** "a flat in a 5-floor building on Lindenstraße" */
function describe(lot: Lot, what: 'flat' | 'house' | 'building'): string {
  if (what === 'house') return `a house${on(lot.street)}`;
  if (what === 'building') return `the whole ${lot.inHouse ? 'house' : 'building'}${on(lot.street)}, ${lot.units} flats`;
  return `a flat in ${floorsA(lot.floors)} ${lot.inHouse ? 'house' : 'building'}${on(lot.street)}`;
}

export interface HomesHost {
  game: Game;
  toast: (text: string, kind?: 'good' | 'bad' | 'info', ms?: number) => void;
  /** keep the cash (and say that something changed, for saving online) */
  save: () => void;
  /** the name of the place being played */
  place: () => string;
  /** the first home was just bought (what it is, its rent each day): saving online opens */
  firstHome?: (what: string, rent: string) => void;
}

export class HomesUi {
  private homes: Homes = loadHomes();
  private world: World | null = null;
  private marks = new Map<Lot, { remove: () => void }>();
  private lookT = 0;
  private welcomed = false;
  private readonly panel = document.getElementById('forsale')!;
  private readonly savedEl = document.getElementById('saved');
  /** cash paid in at a bank of the home plate (`game/bank.ts`) */
  private saved = loadSaved();
  /** the town of the first home, where the banks are */
  private plate: Plate | null = homePlate(this.homes);
  /** whether the square being played is in the home plate */
  private atPlate = false;
  /** the banks of the square, where the home plate's are shown: each with its spot on the road */
  private banks: Array<{ x: number; y: number; rx: number; ry: number; mark: { remove: () => void } }> = [];
  /** what the panel shows, so it is drawn again only when that changes */
  private shown = '';

  constructor(private readonly host: HomesHost) {
    host.game.ticks.push((dt) => this.tick(dt));
    addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'b' || e.repeat || this.panel.hidden) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      this.panel.querySelector<HTMLButtonElement>('button')?.click();
    });
  }

  /** which building of the square being played each home is */
  private owned = new Map<Lot, Home>();

  /** Home kept for a lot of the square being played. */
  private homeOf(lot: Lot): Home | undefined {
    return this.owned.get(lot);
  }

  private tick(dt: number): void {
    const { game } = this.host;
    if (game.world !== this.world) this.enter(game.world);
    if (!this.welcomed) {
      this.welcomed = true;
      this.payRent(true);
    }
    if (this.savedEl) {
      this.savedEl.hidden = !this.plate;
      const text = `Bank ${money(this.saved)}`;
      if (this.savedEl.textContent !== text) this.savedEl.textContent = text;
    }
    this.lookT -= dt;
    if (this.lookT > 0) return;
    this.lookT = 0.25;
    this.look();
  }

  /** A new square: mark the homes in it. */
  private enter(world: World): void {
    this.world = world;
    this.marks.clear();
    this.shown = '';
    this.owned = homesIn(this.homes, world.lots, (lon, lat) => world.proj.toLocal(lon, lat));
    for (const lot of this.owned.keys()) this.marks.set(lot, world.mark(icon(), lot.x, lot.y));
    this.banks = [];
    this.showBanks();
  }

  /** In the home plate, the banks' symbols: on the roof (or by the street, where one is made up) and on the maps. */
  private showBanks(): void {
    const world = this.world;
    if (!world) return;
    const mid = world.proj.toLngLat(0, 0);
    this.atPlate = inPlate(this.plate, mid.lat, mid.lon);
    if (!this.atPlate || this.banks.length) return;
    for (const b of world.banks) {
      const n = world.roads.nearest(b.x, b.y, 150, 'traffic');
      const [rx, ry] = n ? world.roads.point(n.line, n.s) : [b.x, b.y];
      this.banks.push({ x: b.x, y: b.y, rx, ry, mark: world.mark(serviceIcon('bank', !!b.invented), b.x, b.y) });
    }
  }

  /** What the player can spend here: the cash carried, and in the home plate the savings too. */
  private budget(): number {
    return this.host.game.cash + (this.atPlate ? this.saved : 0);
  }

  /** Pay cash in at a bank. */
  payIn(): number {
    const { game } = this.host;
    const amount = Math.min(Math.floor(game.cash), MAX_CASH - this.saved);
    if (amount < 1) return 0;
    game.cash -= amount;
    this.saved += amount;
    storeSaved(this.saved);
    this.host.save();
    this.host.toast(`${money(amount)} paid in. You have ${money(this.saved)} in the bank, safe from fines.`, 'good', 5000);
    this.shown = '';
    this.look();
    return amount;
  }

  /** Pay the rent of a new day, once. On arrival, say so. */
  payRent(arriving = false): number {
    if (!this.homes.homes.length) return 0;
    const due = rentDue(this.homes, Date.now());
    if (due < 1) return 0;
    this.homes.paidDay = dayOf(Date.now());
    saveHomes(this.homes);
    const before = this.host.game.cash;
    this.host.game.cash += due;
    this.host.save();
    // at the most cash one can hold, the rent is not added
    const got = this.host.game.cash - before;
    if (got < 1) return 0;
    if (arriving) countPlay('rent');
    const homes = this.homes.homes.length === 1 ? 'your home' : `your ${this.homes.homes.length} homes`;
    this.host.toast(arriving ? `Welcome back. Today ${homes} paid you ${money(got)} rent.` : `A new day: ${homes} paid you ${money(got)} rent.`, 'good', 9000);
    return got;
  }

  /** Buy a lot of the square being played. */
  buy(lot: Lot, what: 'flat' | 'house' | 'building'): boolean {
    const { game } = this.host;
    const had = this.homeOf(lot);
    const price = what === 'building' ? lot.whole - (had?.paid ?? 0) : lot.price;
    const pay = payFrom(price, game.cash, this.saved, this.atPlate);
    if (!pay || (had && what !== 'building') || had?.kind === 'building') return false;
    // the rent so far goes out first, so the new home's rent starts now
    this.payRent();
    // a first home starts paying tomorrow
    const first = !this.homes.homes.length;
    if (first) this.homes.paidDay = dayOf(Date.now());
    game.cash -= pay.cash;
    if (pay.saved) {
      this.saved -= pay.saved;
      storeSaved(this.saved);
    }
    const ll = this.world!.proj.toLngLat(lot.x, lot.y);
    if (had) {
      had.kind = 'building';
      had.paid += price;
      had.rent = rentFor(had.paid);
    } else {
      const home: Home = { id: lot.id, lat: ll.lat, lon: ll.lon, kind: what, paid: price, rent: rentFor(price), street: lot.street, place: this.host.place(), at: Date.now() };
      this.homes.homes.push(home);
      this.owned.set(lot, home);
      this.marks.set(lot, this.world!.mark(icon(), lot.x, lot.y));
    }
    saveHomes(this.homes);
    this.host.save();
    countPlay('home', what);
    if (first) {
      // this town is now the home plate: its banks show
      this.plate = homePlate(this.homes);
      this.showBanks();
    }
    const mine = this.homeOf(lot)!;
    if (first && this.host.firstHome) this.host.firstHome(describe(lot, what), money(mine.rent));
    else this.host.toast(`It's yours: ${describe(lot, what)}.${pay.saved ? ` ${money(pay.saved)} of it came from the bank.` : ''} It pays ${money(mine.rent)} rent each day you come back.`, 'good', 6000);
    this.shown = '';
    this.look();
    return true;
  }

  /** Stopped beside a building that is for sale: show what it costs. */
  private look(): void {
    const { game } = this.host;
    const world = this.world;
    let found: Lot | null = null;
    let bank = false;
    if (world && game.speed() < 1.2 && !game.held) {
      const [px, py] = game.pos();
      bank = this.banks.some((b) => Math.hypot(b.rx - px, b.ry - py) < BANK_ROAD_M || Math.hypot(b.x - px, b.y - py) < BANK_M);
      let best = BESIDE_M;
      for (const lot of world.lots) {
        if (Math.abs(lot.x - px) > 120 || Math.abs(lot.y - py) > 120) continue;
        const d = distanceTo(lot, px, py);
        if (d < best) {
          best = d;
          found = lot;
        }
      }
    }
    if (bank) found = null;
    const shown = bank ? `bank ${game.cash} ${this.saved}` : found ? `${world!.lots.indexOf(found)} ${game.cash} ${this.saved}` : '';
    if (shown === this.shown) return;
    this.shown = shown;
    this.panel.hidden = !shown;
    if (!shown) return;
    this.panel.replaceChildren();
    if (bank) {
      const title = document.createElement('b');
      title.textContent = 'Bank';
      const p = document.createElement('p');
      p.textContent = `You have ${money(this.saved)} here. Money in the bank is safe from fines and pays for homes in ${this.plate?.place || 'your home town'}.`;
      const b = document.createElement('button');
      const amount = Math.min(Math.floor(game.cash), MAX_CASH - this.saved);
      b.textContent = `Pay in ${money(Math.max(0, amount))}`;
      b.disabled = amount < 1;
      b.addEventListener('click', () => this.payIn());
      this.panel.append(title, p, b);
      return;
    }
    if (!found) return;
    const had = this.homeOf(found);
    const line = (text: string) => {
      const p = document.createElement('p');
      p.textContent = text;
      this.panel.append(p);
    };
    const button = (text: string, price: number, what: 'flat' | 'house' | 'building') => {
      const b = document.createElement('button');
      b.textContent = `${text}  ${money(price)}`;
      b.disabled = this.budget() < price;
      b.addEventListener('click', () => this.buy(found!, what));
      this.panel.append(b);
    };
    const title = document.createElement('b');
    if (had) {
      title.textContent = had.kind === 'building' ? 'Your building' : had.kind === 'house' ? 'Your house' : 'Your flat';
      this.panel.append(title);
      line(`Pays ${money(had.rent)} rent each day you come back.`);
      if (had.kind === 'flat') button('Buy the rest of the building', found.whole - had.paid, 'building');
      return;
    }
    title.textContent = 'For sale';
    this.panel.append(title);
    if (found.kind === 'house') {
      line(`A house${on(found.street)}. Pays ${money(rentFor(found.price))} rent each day you come back.`);
      button('Buy the house', found.price, 'house');
    } else {
      line(`Flats in ${floorsA(found.floors)} ${found.inHouse ? 'house' : 'building'}${on(found.street)}. One pays ${money(rentFor(found.price))} rent each day you come back.`);
      button('Buy a flat', found.price, 'flat');
      button(`Buy all ${found.units}`, found.whole, 'building');
    }
    if (this.budget() < found.price) line(`You have ${money(game.cash)}${this.atPlate && this.saved ? ` and ${money(this.saved)} in the bank` : ''}.`);
  }

  /**
   * After a run: rent paid out, and a home offered near where it ended. The dearest flat or house
   * the cash will buy, or the cheapest and what is missing; and a bigger one to save up for.
   */
  offer(box: HTMLElement): void {
    const { game } = this.host;
    const rent = this.payRent();
    box.replaceChildren();
    const world = this.world;
    if (!world) {
      box.hidden = true;
      return;
    }
    const [px, py] = game.pos();
    const free = world.lots.filter((l) => Math.hypot(l.x - px, l.y - py) < OFFER_M && !this.homeOf(l));
    const cash = this.budget();
    const p = (text: string, cls = '') => {
      const el = document.createElement('p');
      el.textContent = text;
      if (cls) el.className = cls;
      box.append(el);
      return el;
    };
    const owned = this.homes.homes.length;
    if (owned) p(`Your ${owned === 1 ? 'home pays' : `${owned} homes pay`} ${money(rentPerVisit(this.homes))} rent each day you come back${rent ? `. Paid today: ${money(rent)}` : ''}.`, 'small');
    if (!free.length) {
      box.hidden = !owned;
      return;
    }
    box.hidden = false;
    const affordable = free.filter((l) => l.price <= cash).sort((a, b) => b.price - a.price || Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
    const pick = affordable[0];
    const what = (l: Lot) => (l.kind === 'house' ? 'house' : 'flat');
    if (pick) {
      const head = document.createElement('b');
      head.textContent = `For sale near here: ${describe(pick, what(pick))}`;
      box.append(head);
      p(`${money(pick.price)}. You have ${money(cash)}${this.atPlate && this.saved ? ', counting the bank' : ''}. It pays ${money(rentFor(pick.price))} rent each day you come back.`);
      const b = document.createElement('button');
      b.className = 'buy';
      b.textContent = `Buy it for ${money(pick.price)}`;
      b.addEventListener('click', () => {
        if (this.buy(pick, what(pick))) this.offer(box);
      });
      box.append(b);
    } else {
      const cheap = [...free].sort((a, b) => a.price - b.price)[0];
      p(`The cheapest home near here is ${describe(cheap, what(cheap))}: ${money(cheap.price)}. ${money(cheap.price - cash)} more and it's yours.`);
    }
    // something bigger, to aim for: the nearest house or whole building that costs more
    const goal = free
      .filter((l) => (l.kind === 'house' ? l.price : l.whole) > Math.max(cash, pick?.price ?? 0) * 1.5)
      .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
    if (goal) p(`Also near: ${describe(goal, goal.kind === 'house' ? 'house' : 'building')}, ${money(goal.kind === 'house' ? goal.price : goal.whole)}.`, 'small');
    p('Stop beside any building to see its price.', 'small');
  }
}
