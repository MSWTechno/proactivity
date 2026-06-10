#!/usr/bin/env bash
# Phase 1 statewide-VA ingestion (TICKETMASTER channel).
# RUN THIS ONLY AFTER TICKETMASTER_API_KEY is set in ../../.env — otherwise
# every row inserts but errors at ingest ("TICKETMASTER_API_KEY not set").
# See memory: project_statewide_ingestion_strategy.
#
# Hampton Roads + NoVA use 40km tiles (dense, overlapping) to stay under
# Ticketmaster's 5000-result deep-pagination cap (page 49). Others 50km.
#
# !!! RUN ONCE. `sources add` always INSERTs (no upsert). Verify with
#     `pnpm sources list` and disable dupes if you re-run.
#
# Usage:  cd packages/ingestion && bash scripts/add-va-metros-phase1-ticketmaster.sh
set -euo pipefail
cd "$(dirname "$0")/.."

add() { echo "+ sources add $*"; pnpm --silent sources add "$@"; }

# ticketmaster:  <lat> <lng> [radiusKm]
add ticketmaster "Arlington TM"        38.8816 -77.0910 40   # NoVA inner
add ticketmaster "Fairfax TM"          38.8462 -77.3064 40   # NoVA outer
add ticketmaster "Richmond TM"         37.5407 -77.4360 50
add ticketmaster "Virginia Beach TM"   36.8529 -75.9780 40
add ticketmaster "Norfolk TM"          36.8508 -76.2859 40
add ticketmaster "Newport News TM"     37.0871 -76.4730 40
add ticketmaster "Charlottesville TM"  38.0293 -78.4767 50
add ticketmaster "Roanoke TM"          37.2710 -79.9414 50
add ticketmaster "Lynchburg TM"        37.4138 -79.1422 50
add ticketmaster "Blacksburg TM"       37.2296 -80.4139 50
add ticketmaster "Winchester TM"       39.1857 -78.1633 50
add ticketmaster "Staunton TM"         38.1496 -79.0717 50
add ticketmaster "Danville TM"         36.5860 -79.3950 50

echo "Done. Review with: pnpm sources list"
