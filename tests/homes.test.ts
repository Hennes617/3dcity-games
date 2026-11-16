import { describe, expect, it } from 'vitest';
import { dayOf, findLots, homeAt, lotKind, readHomes, rentDue, rentFor, roundPrice, type LotBuilding } from '../src/game/homes';

const box = (x: number, y: number, w: number, h: number, height: number, id: string): LotBuilding => ({
  poly: { outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], holes: [] },
  height,
  id,
});
const around = { areas: [], lines: [], keepClear: [], sights: [], streets: [{ name: 'Lindenstraße', pts: [[-300, 0], [300, 0]] as Array<[number, number]> }], half: 750 };

describe('homes', () => {
  it('splits buildings into flats, houses and what is not for sale', () => {
    expect(lotKind(20, 1)).toBeNull(); // a garage
    expect(lotKind(120, 2)).toEqual({ kind: 'house', units: 1 });
    expect(lotKind(2000, 1)).toBeNull(); // a hall
    expect(lotKind(300, 5)?.kind).toBe('flats');
    expect(lotKind(300, 5)?.units).toBe(17);
  });

  it('prices so that the cheapest flats cost about one run and dear spots cost more', () => {
    const b: LotBuilding[] = [];
    for (let i = 0; i < 40; i++) b.push(box(-200 + i * 12, 5, 10, 20, i % 2 ? 17 : 7, String(i)));
    const lots = findLots(b, around);
    const flats = lots.filter((l) => l.kind === 'flats').map((l) => l.price);
    expect(Math.min(...flats)).toBeGreaterThanOrEqual(600);
    expect(Math.min(...flats)).toBeLessThanOrEqual(800);
    expect(Math.max(...flats)).toBeGreaterThan(Math.min(...flats) * 2.5);
    expect(lots.every((l) => l.street === 'Lindenstraße')).toBe(true);
    // the whole building is its flats together
    for (const l of lots.filter((x) => x.kind === 'flats')) expect(l.whole).toBeGreaterThanOrEqual(l.price * l.units * 0.9);
  });

  it('keeps nothing for sale next to a sight or a school', () => {
    const lots = findLots([box(0, 10, 10, 20, 17, 'a'), box(200, 10, 10, 20, 17, 'b')], { ...around, keepClear: [[5, 20]] });
    expect(lots.map((l) => l.id)).toEqual(['b']);
  });

  it('rounds prices to two figures that matter', () => {
    expect(roundPrice(783)).toBe(780);
    expect(roundPrice(4321)).toBe(4300);
    expect(roundPrice(18420)).toBe(18000);
  });

  it('pays rent once for each day one comes back, however long one was away', () => {
    const monday = new Date(2026, 10, 16, 9).getTime();
    const h = readHomes(JSON.stringify({ v: 1, homes: [{ id: '1', lat: 0, lon: 0, kind: 'flat', paid: 700, rent: 0, street: '', place: '', at: 0 }], paidDay: dayOf(monday) }));
    expect(rentFor(700)).toBe(168);
    expect(h.homes[0].rent).toBe(168); // from the price, whatever was kept
    expect(rentDue(h, monday + 6 * 3600 * 1000)).toBe(0); // the same day
    expect(rentDue(h, new Date(2026, 10, 17, 0, 5).getTime())).toBe(168); // just after midnight
    expect(rentDue(h, new Date(2026, 10, 30).getTime())).toBe(168); // two weeks away: still one day
  });

  it('reads what an earlier version kept', () => {
    const h = readHomes(JSON.stringify({ v: 1, homes: [], paidUntil: new Date(2026, 10, 16, 12).getTime() }));
    expect(h.paidDay).toBe('2026-11-16');
  });

  it('finds a home by the map number, or where it stood when the map has redrawn it', () => {
    const h = readHomes(JSON.stringify({ v: 1, homes: [{ id: '7', lat: 49.45, lon: 11.07, kind: 'house', paid: 1, rent: 1, street: '', place: '', at: 0 }], paidDay: '2026-11-16' }));
    expect(homeAt(h, { id: '7' }, 0, 0)).toBeTruthy();
    expect(homeAt(h, { id: '8' }, 49.45001, 11.07)).toBeTruthy(); // 1 m away
    expect(homeAt(h, { id: '8' }, 49.4502, 11.07)).toBeUndefined(); // 22 m away
  });
});
