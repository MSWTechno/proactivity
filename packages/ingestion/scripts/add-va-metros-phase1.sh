#!/usr/bin/env bash
# Phase 1 statewide-VA ingestion (SCRAPER channel): Eventbrite + Meetup per metro.
# See memory: project_statewide_ingestion_strategy (breadth-first / thin).
#
# Ticketmaster rows are split into add-va-metros-phase1-ticketmaster.sh because
# TICKETMASTER_API_KEY is not set as of 2026-06-09 — adding them now would just
# create dead errored rows. Run that script once the key is in ../../.env.
#
# Each metro gets the proven jsonld-event trio members that work today:
#   - Eventbrite city discovery page
#   - Meetup city find page (50mi)
#
# Already covered (do NOT re-add): Harrisonburg, Lake Anna/Mineral,
#   Fredericksburg + Spotsylvania, Cape Charles.
#
# !!! RUN ONCE. `sources add` always INSERTs (no upsert) — running this twice
#     creates duplicate rows. Verify with `pnpm sources list` first; if you
#     re-run, `pnpm sources disable <id>` the dupes.
#
# Usage:  cd packages/ingestion && bash scripts/add-va-metros-phase1.sh
set -euo pipefail
cd "$(dirname "$0")/.."

add() { echo "+ sources add $*"; pnpm --silent sources add "$@"; }

# jsonld-event:  <entryUrl> <lat> <lng> [availability=onsale] [maxPages=5]

# ============================ Northern Virginia ==============================
add jsonld-event "Eventbrite Arlington"    "https://www.eventbrite.com/d/va--arlington/events/"  38.8816 -77.0910 onsale 5
add jsonld-event "Meetup Arlington"        "https://www.meetup.com/find/?location=us--va--Arlington&source=EVENTS&distance=fiftyMiles" 38.8816 -77.0910 onsale 3
add jsonld-event "Eventbrite Fairfax"      "https://www.eventbrite.com/d/va--fairfax/events/"     38.8462 -77.3064 onsale 5
add jsonld-event "Meetup Fairfax"          "https://www.meetup.com/find/?location=us--va--Fairfax&source=EVENTS&distance=fiftyMiles"   38.8462 -77.3064 onsale 3
add jsonld-event "Eventbrite Alexandria"   "https://www.eventbrite.com/d/va--alexandria/events/"  38.8048 -77.0469 onsale 5

# ================================ Richmond ===================================
add jsonld-event "Eventbrite Richmond"     "https://www.eventbrite.com/d/va--richmond/events/"    37.5407 -77.4360 onsale 5
add jsonld-event "Meetup Richmond"         "https://www.meetup.com/find/?location=us--va--Richmond&source=EVENTS&distance=fiftyMiles"  37.5407 -77.4360 onsale 3

# ============================== Hampton Roads ================================
add jsonld-event "Eventbrite Virginia Beach" "https://www.eventbrite.com/d/va--virginia-beach/events/" 36.8529 -75.9780 onsale 5
add jsonld-event "Meetup Virginia Beach"   "https://www.meetup.com/find/?location=us--va--Virginia-Beach&source=EVENTS&distance=fiftyMiles" 36.8529 -75.9780 onsale 3
add jsonld-event "Eventbrite Norfolk"      "https://www.eventbrite.com/d/va--norfolk/events/"     36.8508 -76.2859 onsale 5
add jsonld-event "Meetup Norfolk"          "https://www.meetup.com/find/?location=us--va--Norfolk&source=EVENTS&distance=fiftyMiles"   36.8508 -76.2859 onsale 3
add jsonld-event "Eventbrite Newport News" "https://www.eventbrite.com/d/va--newport-news/events/" 37.0871 -76.4730 onsale 5
add jsonld-event "Meetup Newport News"     "https://www.meetup.com/find/?location=us--va--Newport-News&source=EVENTS&distance=fiftyMiles" 37.0871 -76.4730 onsale 3

# ============================= Charlottesville ===============================
add jsonld-event "Eventbrite Charlottesville" "https://www.eventbrite.com/d/va--charlottesville/events/" 38.0293 -78.4767 onsale 5
add jsonld-event "Meetup Charlottesville"  "https://www.meetup.com/find/?location=us--va--Charlottesville&source=EVENTS&distance=fiftyMiles" 38.0293 -78.4767 onsale 3

# ================================ Roanoke ====================================
add jsonld-event "Eventbrite Roanoke"      "https://www.eventbrite.com/d/va--roanoke/events/"     37.2710 -79.9414 onsale 5
add jsonld-event "Meetup Roanoke"          "https://www.meetup.com/find/?location=us--va--Roanoke&source=EVENTS&distance=fiftyMiles"   37.2710 -79.9414 onsale 3

# =============================== Lynchburg ===================================
add jsonld-event "Eventbrite Lynchburg"    "https://www.eventbrite.com/d/va--lynchburg/events/"   37.4138 -79.1422 onsale 5
add jsonld-event "Meetup Lynchburg"        "https://www.meetup.com/find/?location=us--va--Lynchburg&source=EVENTS&distance=fiftyMiles" 37.4138 -79.1422 onsale 3

# ========================= Blacksburg / Christiansburg =======================
add jsonld-event "Eventbrite Blacksburg"   "https://www.eventbrite.com/d/va--blacksburg/events/"  37.2296 -80.4139 onsale 5
add jsonld-event "Meetup Blacksburg"       "https://www.meetup.com/find/?location=us--va--Blacksburg&source=EVENTS&distance=fiftyMiles" 37.2296 -80.4139 onsale 3

# =============================== Winchester ==================================
add jsonld-event "Eventbrite Winchester"   "https://www.eventbrite.com/d/va--winchester/events/"  39.1857 -78.1633 onsale 5
add jsonld-event "Meetup Winchester"       "https://www.meetup.com/find/?location=us--va--Winchester&source=EVENTS&distance=fiftyMiles" 39.1857 -78.1633 onsale 3

# ========================= Staunton / Waynesboro =============================
add jsonld-event "Eventbrite Staunton"     "https://www.eventbrite.com/d/va--staunton/events/"    38.1496 -79.0717 onsale 5
add jsonld-event "Meetup Staunton"         "https://www.meetup.com/find/?location=us--va--Staunton&source=EVENTS&distance=fiftyMiles" 38.1496 -79.0717 onsale 3

# ================================ Danville ===================================
add jsonld-event "Eventbrite Danville"     "https://www.eventbrite.com/d/va--danville/events/"    36.5860 -79.3950 onsale 5
add jsonld-event "Meetup Danville"         "https://www.meetup.com/find/?location=us--va--Danville&source=EVENTS&distance=fiftyMiles" 36.5860 -79.3950 onsale 3

echo "Done. Review with: pnpm sources list"
