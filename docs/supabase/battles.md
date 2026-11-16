# Battle mode: the server side

Two players, the same deliveries, live. Applied to the Supabase project through the connector on
16 November 2026 (migrations `battles` and `battle_claim_fix`).

- `public.battles` (id, course, place, host_hash, guest_hash, created_at): which run a battle is
  and its two players, known only by the sha256 of random tokens their browsers made for it.
- `public.battle_claims` (battle_id, round, what `pickup`|`drop`, player 1|2, at): who was first at
  each package and drop-off. The first claim to arrive stands.
- Both tables are closed to browsers. Browsers call three functions:
  `battle_create(token, course, place)` → id (at most 2000 a day in all);
  `battle_join(battle, token)` → `{me, course, place}` with `me` 1 host, 2 guest, 0 full, or null
  when there is no such battle (they last a day);
  `battle_claim(battle, token, round, what)` → the player who was first.
- Positions, bumps, the start and "taken" pass over a Realtime broadcast channel `battle:<id>` and
  are not kept. The channel is public: whoever knows the id (12 hex characters) can listen and send.
- Free-plan limits that matter (Supabase docs, November 2026): 100 messages a second for the whole
  project, 2 million a month, a message counting once when sent and once for each receiver. At 8
  car positions a second a battle uses about 32 a second: three battles at the same moment fit, a
  five-minute battle is about 10,000 messages, some 200 battles a month.
- Old battles and claims are not cleaned up yet.
