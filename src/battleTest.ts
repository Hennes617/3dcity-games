// a page for trying the line between two players without the game; not part of the build
import { battleInLink, hostBattle, joinBattle, type Battle } from './battleNet';
const log: unknown[] = [];
const w = window as unknown as { battle?: Battle; log: unknown[]; ready?: boolean; error?: string };
w.log = log;
const wire = (b: Battle): void => {
  for (const e of ['peer', 'car', 'hit', 'go', 'taken', 'over'] as const) b.on(e, ((...a: unknown[]) => log.push([e, ...a])) as never);
  w.battle = b;
  w.ready = true;
};
const id = battleInLink(location.search);
(id ? joinBattle(id, 'Guest') : hostBattle('WzIsIlRlc3QiXQ', 'Testville', 'Host')).then((b) => (b ? wire(b) : (w.error = 'no such battle')), (e) => (w.error = String(e)));
