-- How the game is played, counted per day: visits (new or back, and where from) and what happens in
-- play (runs finished, homes bought, rent collected on a return). Counts only: a day, a word and a
-- number. Nothing about the player, no address, no place. Written only through count_play().
-- Applied to the project on 16 November 2026 as the migrations "play_counts" and "play_counts_fix_conflict".
--
-- Read it with:
--   select day, kind, detail, n from play_counts order by day desc, kind, detail;

create table public.play_counts (
  day date not null default ((now() at time zone 'utc'))::date,
  kind text not null,
  detail text not null default '',
  n bigint not null default 0,
  primary key (day, kind, detail)
);
comment on table public.play_counts is
  'Per day (UTC): visits (new: a browser seen for the first time; back: the first visit of a day by a browser seen before; detail: where it came from) and play (run: a run of three finished; home: a home bought, detail flat/house/building; rent: rent collected on a return). Counts only. Written through count_play().';

alter table public.play_counts enable row level security;
-- no policies: browsers cannot read or write the table, only call count_play()

create or replace function public.count_play(kind text, detail text default '')
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare d text := coalesce(count_play.detail, '');
begin
  -- only the words the game sends; anything else is dropped
  if count_play.kind not in ('new', 'back', 'run', 'home', 'rent') then return; end if;
  if count_play.kind in ('new', 'back') and d not in ('direct', 'youtube', 'search', 'challenge', 'link') then d := 'other'; end if;
  if count_play.kind = 'home' and d not in ('flat', 'house', 'building') then d := ''; end if;
  if count_play.kind in ('run', 'rent') then d := ''; end if;
  -- the constraint by name: "kind" alone would be both this function's argument and the column
  insert into public.play_counts as p (day, kind, detail, n) values ((now() at time zone 'utc')::date, count_play.kind, d, 1)
  on conflict on constraint play_counts_pkey do update set n = p.n + 1;
end $$;

revoke all on function public.count_play(text, text) from public, authenticated;
grant execute on function public.count_play(text, text) to anon;
