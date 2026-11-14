# The paid version: what it needs behind the scenes

One page, for the owner to decide from. Nothing here is built. Prices and terms are from memory and
earlier searches; check each one on the provider's own page before committing.

## What has to exist

| Part | What it means | Needs |
| --- | --- | --- |
| Accounts | A way to know "this is the same person, and they have paid". | Sign-in by a link sent to an email address (no password). The address is the only personal data. |
| Kept progress | Garage, cars and earnings follow you to another device. | One small saved record per account on a server. |
| Friends league | A private board per group; one run per city per week; everyone's time on it. | Tables for groups, members and times. A group is joined by an invite link. The week's run is worked out from the city and the week number, so no server job is needed. |
| Keeping non-payers out | See the options below. | A server that knows who has paid. |
| Taking money | Someone must charge the card and deal with VAT in each buyer's country. | A "merchant of record": a shop that is legally the seller, so the owner gets payouts and does no VAT filing per country. |

**The privacy promise changes, and that is the owner's decision.** Today: no accounts, no cookies, no
analytics. With a paid version it would read: *the free game needs no account and collects nothing;
the full version needs an email address to sign in, and stores your progress and league times.* Still
no analytics, no advertising and no tracking cookies. The privacy page would need a new section.

Times are sent by the player's browser, so a determined player could fake one. Among friends that is
tolerable; a public world board would need more work and is not proposed.

## Three ways to keep the paid part from non-payers

A browser game sends its code to every player, so a private repository hides the source and nothing
else. The choices:

| | A. Sell and host it on itch.io | B. Own host that hands the paid code only to payers | C. Paid things live on the server |
| --- | --- | --- | --- |
| How | itch.io takes the money and serves the paid build only to buyers. | A small server program checks the sign-in before sending the paid part of the game. | The code is not hidden. Garage, progress and league are kept on the server, and the server refuses accounts that have not paid. |
| Is the code hidden? | From non-buyers, yes. | Yes. | No, but it does nothing without a paid account. |
| Cost | A share of each sale that the seller sets (10% is the default) plus payment fees. No monthly cost. | Hosting about 0 to 25 EUR a month, plus about 5% + 0.50 per sale to the merchant of record. | The same as B. |
| Effort | Small for the shop. But the league and kept progress still need accounts and a server, and a buyer on itch has to be matched to an account. | Largest: everything in C, plus splitting the game in two and guarding one half. | Medium: the accounts, progress and league have to be built anyway; the paid check is one more rule on the same tables. |
| Weak point | The game plays inside itch's page, away from the free game's address. | Most to build and to keep running. | Someone could copy the look of the garage and cars. They could not get kept progress or a league. |

## Recommendation: C, in the Supabase project family already in use

- Everything the paid version promises (kept progress, a league) only works with a server, so the
  server is the natural lock. Hiding code as well (B) costs the most and protects the least.
- Supabase already holds the waiting list in Frankfurt. The same service does email sign-in and the
  tables, with rules of the kind already tested on the waiting list ("a visitor may do this and
  nothing else"). Free at first; about 25 USD a month once the free tier is too small or its pause
  after a quiet week becomes a nuisance.
- Money through a merchant of record (Paddle or Lemon Squeezy are the usual two). After a payment the
  shop tells the server, and the server marks the account as paid. itch.io can be added later as a
  second shop window; it should not be the only door.
- The free game stays exactly as it is, at the same address, with no sign-in anywhere in it.

Rough order and size, once the waiting list says it is worth doing: sign-in and kept progress (about a
week of sessions), the league (about a week), payment (a few days plus the shop's approval, which can
take a week or two), then the garage and cars themselves, which is game work.

## Decisions for the owner

1. Is an email sign-in for the full version acceptable, with the privacy promise reworded as above?
2. Is C acceptable, knowing the paid look could be copied but not the paid service?
3. One price once, or a yearly price? A server costs money every month; a one-time price does not.
4. What number of sign-ups on the waiting list, by when, means "build it"?
