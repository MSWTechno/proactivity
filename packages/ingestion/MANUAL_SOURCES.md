# Manual ingest sources — annual re-pull checklist

Every event below was pulled in by a one-off **idempotent script** in
`scripts/` (each is a permanent, re-runnable record). Auto-running sources
(Eventbrite/Meetup/iCal/RSS in the `sources` DB table) refresh on their own via
the cron runner and are **not** listed here.

**Next year:** open each script, bump the dates (and re-verify prices/URLs from
the source), then run:
```
pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env scripts/<file>.ts
```
Scripts upsert on (sourceId, sourceEventId), so re-running is safe.

> Tip: most of these are **seasonal (summer)** and announced **late May / early
> June**. Set a reminder for ~mid-May to start re-pulling.

## Recurring — re-pull every year (summer/seasonal)

| Source / organizer | Type | 2026 dates | Where it came from | Script |
|---|---|---|---|---|
| Shenandoah Valley lawn-party season (12 events: Clover Hill, Bergton car show, Briery Branch, Tenth Legion, Keezletown, West Rockingham, Mt Crawford, Bridgewater, Augusta Co Fair, Fulks Run, McGaheysville, Rockingham Co Fair) | Lawn parties / fairs | late May–Aug | regional calendar image; venues web-verified | `ingest-lawn-parties-2026.ts` |
| Weyers Cave VFC Lawn Party | Lawn party | Jun 3–6 | same calendar image | `ingest-weyers-cave-lawn-party-2026.ts` |
| Sipe Center Summer Movie Series (20 free kids' movies) | Movies | Jun 10–Aug 13 | sipecenter.com | `ingest-sipe-center-summer-movies-2026.ts` |
| Shenandoah Valley Bach Festival | Music festival | Jun 8–14 | svbachfestival.org | `ingest-sv-bach-festival-2026.ts` |
| BRCC Summer Youth Classes (Ceramics, Drone Zone, Pre-Vet) | Youth classes | Jun–Aug | brcc.edu/workforce-development/summer-youth-classes | `ingest-brcc-summer-youth-2026.ts` |
| Sampson Basketball Academy (Girls + Boys overnight) | Basketball camp | Jul 13–15, Jul 20–23 | flyer + sampsonbasketballacademy.com | `ingest-sba-girls-basketball-camp-2026.ts`, `ingest-sba-boys-basketball-camp-2026.ts` |
| Coach Powers Basketball Camps (Girls + Boys overnight) | Basketball camp | Jul 13–15, Jul 20–23 | flyer + sites.google.com/powersbballcamp.com (NOTE: powersbballcamp.com has a bad TLS cert) | `ingest-powers-basketball-camp-2026.ts` |
| Rockingham County Youth Volleyball Clinic (3rd–5th, 6th–8th) | Sports clinic | Jun 23–Jul 30, Tue/Thu | flyer + rec1 registration | `ingest-rockingham-youth-volleyball-clinic-2026.ts` |
| Luxe Volleyball Academy open gym/play | Sports | Jun (rolling) | flyers; org key `user:luxe-volleyball-academy-c0cd53` | `ingest-luxe-open-gym-2026.ts` |
| Rockingham Rec Center open gym | Drop-in sports | weekly | flyer; facebook.com/rockinghamcountyrecreation | `ingest-rockingham-rec-open-gym-2026.ts` |
| Hburg Parks & Rec special events | Community | summer | hburg parks & rec | `ingest-hburg-parks-rec-2026.ts` |
| Levitt AMP Harrisonburg (free concerts) | Music | summer | AMPHburg.com (verify times!) | `ingest-levitt-amp-2026.ts` |
| ACTS volleyball clinics (Staunton, out of radius) | Sports | summer | flyer | `ingest-acts-vb-clinics-2026.ts` |
| VA women's college bball camps (Google Sheet) | Sports camps | summer | Google Sheet | `ingest-va-wbb-camps-2026.ts` |
| Rovo / Rocktown Volleyball | Sports | rolling | pre-existing | `ingest-rovo-2026.ts` |
| Snapology of Harrisonburg — STEAM/robotics camps (45 sessions, 4 venues: Mt. Crawford SnapShop, Redeemer Classical, JMU BCM, DUCC) | STEAM/robotics day camps | Jun 8–Aug 14, Mon–Fri | saved MHTML of embed.snapology.com/licensee/150 registration list | `ingest-snapology-summer-camps-2026.ts` |
| JMU "Loren LaPorte" Softball Camps (Jr. Dukes All-Skills + Prospect, 5 days) | Softball camps | Jun 23, Jun 24, Jul 14, Jul 15, Aug 23 | 2026 flyer + lorenlaportecamps.com / Ryzer (prices are 2025 rate — re-verify) | `ingest-jmu-softball-camps-2026.ts` |
| Ryzer sports-camp sweep (JMU, EMU, Bridgewater College, independents — ~26 camps within 50 mi of 22801) | College/sports camps | rolling (summer) | **live** Ryzer `event/eventSearch` API (re-run anytime to refresh; skips JMU softball dupes) | `ingest-ryzer-harrisonburg-camps.ts` |
| Explore More Discovery Museum — "Summer Spark" weekly drop-ins (Tinker Time, Making Masterpieces, Science Explorers, Preschool Paint n' Play) | Free museum programs | weekly, Jun 2–~Aug 31 (end approximate) | iexploremore.com/weeklysummer2026 (verify end date + that it recurs) | `ingest-explore-more-summer-spark-2026.ts` |
| Camp Horizons — overnight outdoor camp (Base, Equestrian, Leadership, Adventure; 15 sessions) | Outdoor overnight camps | Jun 14–Aug 15 | camphorizons.com/dates-rates | `ingest-camp-horizons-2026.ts` |

### VBS / Christian kids camps (summer, annual)
| Church | 2026 dates | Source | Script |
|---|---|---|---|
| Trissels & Grace Mennonite — "Running for the Prize" | Jun 7–11 | flyer + trisselsmc.org | `ingest-trissels-grace-vbs-2026.ts` |
| Harrisonburg First Assembly — "Illumination Station" | Jun 14–18 | Subsplash event page | `ingest-hfa-illumination-vbs-2026.ts` |
| Faith Baptist (Broadway) — "Camp Faith" | Jun 8–10 | flyer + faithbaptistbroadway.org | `ingest-faith-baptist-camp-faith-vbs-2026.ts` |
| New Beginnings Church — "Into the Wild" | Jul 6–10 | flyer + nbcfamily.com | `ingest-nbc-into-the-wild-kids-camp-2026.ts` |

## One-off / uncertain recurrence (re-check before assuming they repeat)

| Source | Type | Note | Script |
|---|---|---|---|
| Rotary + Rockingham Parks — Community Impact Day | Food/coat drive + dedication | Jun 6, 2026 — a one-time partnership/dedication | `ingest-rotary-community-impact-2026.ts` |
| Wild Child "Jungle Jubilee" | Family festival | 1st-anniversary event; may not recur | `ingest-wild-child-jungle-jubilee-2026.ts` |
| The Secret Lair — MTG/Pokemon pre-releases | Game shop | tied to game release schedule, not annual dates | `ingest-secret-lair-2026.ts` |

## Still to add (2026)
- **Stuarts Draft VFC Lawn Party** — only "Mid-August" known; needs a confirmed date (venue: 118 Draft Ave, Stuarts Draft; sdvfc.org).
- **Charlottesville local calendars** — Eventbrite + Meetup Charlottesville already auto-source; local iCal calendars TBD.
