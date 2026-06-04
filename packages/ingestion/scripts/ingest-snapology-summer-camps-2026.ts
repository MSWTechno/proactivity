/**
 * One-off ingestion for Snapology of Harrisonburg, VA — Summer 2026 STEAM &
 * robotics camps (licensee 150). Source: the public registration list at
 * embed.snapology.com/licensee/150/events/location, captured 2026-06-04.
 *
 * Run:
 *   pnpm --filter @proactivity/ingestion exec tsx --env-file=../../.env \
 *     scripts/ingest-snapology-summer-camps-2026.ts
 *
 * Idempotent (onConflictDoUpdate refreshes price/desc on re-run). One row per
 * camp session (a week-long, Mon–Fri day camp). Four rotating venues around
 * Harrisonburg. Paid; register through Snapology of Harrisonburg.
 */
import { db, activities, sources } from '@proactivity/db';
import { eq } from 'drizzle-orm';

const ORGANIZER_NAME = 'Snapology of Harrisonburg';
const ORGANIZER_KEY = 'snapology-harrisonburg-2026-import';
const ORGANIZER_URL = 'https://www.snapology.com/virginia-harrisonburg/';
const URL = 'https://embed.snapology.com/licensee/150/events/location';
const EDT = '-04:00';

interface Venue { name: string; address: string; city: string; region: string; lat: number; lng: number; }
const VENUES: Record<string, Venue> = {
  mtcrawford: { name: 'Mt. Crawford Snapology Workshop', address: '555 Old Bridgewater Rd', city: 'Mount Crawford', region: 'VA', lat: 38.3486, lng: -78.9430 },
  redeemer:   { name: 'Redeemer Classical School', address: '1688 Indian Trail Rd', city: 'Keezletown', region: 'VA', lat: 38.4339, lng: -78.7686 },
  jmubcm:     { name: 'JMU Baptist Collegiate Ministries (BCM)', address: '711 S Main St', city: 'Harrisonburg', region: 'VA', lat: 38.4348, lng: -78.8702 },
  ducc:       { name: 'Divine Unity Community Church (DUCC)', address: '1680 Country Club Rd', city: 'Harrisonburg', region: 'VA', lat: 38.4716, lng: -78.8490 },
};

interface CampEvent {
  title: string; vkey: string; startDate: string; endDate: string;
  startTime: string; endTime: string; ageMin: number; ageMax: number;
  costCents: number; description: string;
}

const EVENTS: CampEvent[] = [
  { title: "Pokemania", vkey: "mtcrawford", startDate: "2026-06-08", endDate: "2026-06-12", startTime: "09:00", endTime: "12:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Pokemania — a Snapology STEAM & robotics summer camp (ages 6–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Jun 8–Jun 12, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Creature Creator Robotics", vkey: "mtcrawford", startDate: "2026-06-08", endDate: "2026-06-12", startTime: "13:00", endTime: "16:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Creature Creator Robotics — a Snapology STEAM & robotics summer camp (ages 6–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Jun 8–Jun 12, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Jedi Masters", vkey: "redeemer", startDate: "2026-06-08", endDate: "2026-06-12", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Jedi Masters — a Snapology STEAM & robotics summer camp (ages 5–12) at the Redeemer Classical School. Jun 8–Jun 12, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Underwater Explorers", vkey: "redeemer", startDate: "2026-06-08", endDate: "2026-06-12", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 7, costCents: 17500, description: "Underwater Explorers — a Snapology STEAM & robotics summer camp (ages 4–7) at the Redeemer Classical School. Jun 8–Jun 12, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Junior Scientists: All About Animals", vkey: "mtcrawford", startDate: "2026-06-08", endDate: "2026-06-12", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 6, costCents: 17500, description: "Junior Scientists: All About Animals — a Snapology STEAM & robotics summer camp (ages 4–6) at the Mt. Crawford Snapology Workshop (SnapShop!). Jun 8–Jun 12, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Animation Studio", vkey: "redeemer", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "09:00", endTime: "12:00", ageMin: 8, ageMax: 14, costCents: 17500, description: "Animation Studio — a Snapology STEAM & robotics summer camp (ages 8–14) at the Redeemer Classical School. Jun 15–Jun 19, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Mining & Building", vkey: "jmubcm", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "09:00", endTime: "12:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Mining & Building — a Snapology STEAM & robotics summer camp (ages 6–12) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 15–Jun 19, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Engineering Mechanical Masterminds + Combat Robots", vkey: "jmubcm", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "13:00", endTime: "16:00", ageMin: 9, ageMax: 14, costCents: 17500, description: "Engineering Mechanical Masterminds + Combat Robots — a Snapology STEAM & robotics summer camp (ages 9–14) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 15–Jun 19, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "RoboPets Robotics", vkey: "redeemer", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 7, costCents: 17500, description: "RoboPets Robotics — a Snapology STEAM & robotics summer camp (ages 4–7) at the Redeemer Classical School. Jun 15–Jun 19, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Ninja, Jedi, & Pokémania Camp", vkey: "redeemer", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 10, costCents: 17500, description: "Ninja, Jedi, & Pokémania Camp — a Snapology STEAM & robotics summer camp (ages 5–10) at the Redeemer Classical School. Jun 15–Jun 19, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "LEGO® League Explore CAMP (UNEARTHED Archaeology theme)", vkey: "jmubcm", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 10, costCents: 17500, description: "LEGO® League Explore CAMP (UNEARTHED Archaeology theme) — a Snapology STEAM & robotics summer camp (ages 5–10) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 15–Jun 19, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Junior Engineers", vkey: "jmubcm", startDate: "2026-06-15", endDate: "2026-06-19", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 6, costCents: 17500, description: "Junior Engineers — a Snapology STEAM & robotics summer camp (ages 4–6) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 15–Jun 19, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "GameBots Robotics", vkey: "jmubcm", startDate: "2026-06-22", endDate: "2026-06-26", startTime: "09:00", endTime: "12:00", ageMin: 8, ageMax: 13, costCents: 17500, description: "GameBots Robotics — a Snapology STEAM & robotics summer camp (ages 8–13) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 22–Jun 26, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Video Games Favorites", vkey: "jmubcm", startDate: "2026-06-22", endDate: "2026-06-26", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Video Games Favorites — a Snapology STEAM & robotics summer camp (ages 5–12) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 22–Jun 26, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Mini-Figure Mania", vkey: "jmubcm", startDate: "2026-06-22", endDate: "2026-06-26", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 10, costCents: 17500, description: "Mini-Figure Mania — a Snapology STEAM & robotics summer camp (ages 5–10) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 22–Jun 26, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "RoboRides Robotics", vkey: "jmubcm", startDate: "2026-06-22", endDate: "2026-06-26", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 9, costCents: 17500, description: "RoboRides Robotics — a Snapology STEAM & robotics summer camp (ages 5–9) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 22–Jun 26, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Castles and Kingdoms", vkey: "jmubcm", startDate: "2026-06-29", endDate: "2026-07-03", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 11, costCents: 17500, description: "Castles and Kingdoms — a Snapology STEAM & robotics summer camp (ages 5–11) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 29–Jul 3, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "KinderBots Robotics", vkey: "jmubcm", startDate: "2026-06-29", endDate: "2026-07-03", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 7, costCents: 17500, description: "KinderBots Robotics — a Snapology STEAM & robotics summer camp (ages 4–7) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 29–Jul 3, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "AttackBot Robotics", vkey: "jmubcm", startDate: "2026-06-29", endDate: "2026-07-03", startTime: "09:00", endTime: "12:00", ageMin: 7, ageMax: 14, costCents: 17500, description: "AttackBot Robotics — a Snapology STEAM & robotics summer camp (ages 7–14) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 29–Jul 3, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Military Patriots", vkey: "jmubcm", startDate: "2026-06-29", endDate: "2026-07-03", startTime: "13:00", endTime: "16:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Military Patriots — a Snapology STEAM & robotics summer camp (ages 6–12) at the JMU BCM (Baptist Collegiate Ministries student center). Jun 29–Jul 3, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Animation Studio for Girls", vkey: "mtcrawford", startDate: "2026-06-29", endDate: "2026-07-03", startTime: "13:00", endTime: "16:00", ageMin: 7, ageMax: 14, costCents: 17500, description: "Animation Studio for Girls — a Snapology STEAM & robotics summer camp (ages 7–14) at the Mt. Crawford Snapology Workshop (SnapShop!). Jun 29–Jul 3, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Wonderful Wizards", vkey: "jmubcm", startDate: "2026-07-06", endDate: "2026-07-10", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Wonderful Wizards — a Snapology STEAM & robotics summer camp (ages 5–12) at the JMU BCM (Baptist Collegiate Ministries student center). Jul 6–Jul 10, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Animation Studio", vkey: "jmubcm", startDate: "2026-07-06", endDate: "2026-07-10", startTime: "09:00", endTime: "12:00", ageMin: 7, ageMax: 14, costCents: 17500, description: "Animation Studio — a Snapology STEAM & robotics summer camp (ages 7–14) at the JMU BCM (Baptist Collegiate Ministries student center). Jul 6–Jul 10, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "ThinkerBots Robotics", vkey: "jmubcm", startDate: "2026-07-06", endDate: "2026-07-10", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 9, costCents: 17500, description: "ThinkerBots Robotics — a Snapology STEAM & robotics summer camp (ages 5–9) at the JMU BCM (Baptist Collegiate Ministries student center). Jul 6–Jul 10, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Snapology’s Amazing Race", vkey: "jmubcm", startDate: "2026-07-06", endDate: "2026-07-10", startTime: "13:00", endTime: "16:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Snapology’s Amazing Race — a Snapology STEAM & robotics summer camp (ages 6–12) at the JMU BCM (Baptist Collegiate Ministries student center). Jul 6–Jul 10, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "RoboRides Robotics", vkey: "ducc", startDate: "2026-07-13", endDate: "2026-07-17", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 8, costCents: 17500, description: "RoboRides Robotics — a Snapology STEAM & robotics summer camp (ages 5–8) at the DUCC (Divine Unity Community Church). Jul 13–Jul 17, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Engineering Favorites", vkey: "ducc", startDate: "2026-07-13", endDate: "2026-07-17", startTime: "13:00", endTime: "16:00", ageMin: 7, ageMax: 13, costCents: 17500, description: "Engineering Favorites — a Snapology STEAM & robotics summer camp (ages 7–13) at the DUCC (Divine Unity Community Church). Jul 13–Jul 17, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Jedi Masters", vkey: "ducc", startDate: "2026-07-13", endDate: "2026-07-17", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Jedi Masters — a Snapology STEAM & robotics summer camp (ages 5–12) at the DUCC (Divine Unity Community Church). Jul 13–Jul 17, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Junior Builders & Bot Builders with Cubelets®", vkey: "mtcrawford", startDate: "2026-08-03", endDate: "2026-08-07", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 6, costCents: 17500, description: "Junior Builders & Bot Builders with Cubelets® — a Snapology STEAM & robotics summer camp (ages 4–6) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 3–Aug 7, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Brick City Camp", vkey: "mtcrawford", startDate: "2026-08-03", endDate: "2026-08-07", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Brick City Camp — a Snapology STEAM & robotics summer camp (ages 5–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 3–Aug 7, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Discovering Dinosaurs and Prehistoric Creatures Robotics", vkey: "mtcrawford", startDate: "2026-08-03", endDate: "2026-08-07", startTime: "09:00", endTime: "12:00", ageMin: 7, ageMax: 12, costCents: 17500, description: "Discovering Dinosaurs and Prehistoric Creatures Robotics — a Snapology STEAM & robotics summer camp (ages 7–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 3–Aug 7, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Brick Art, Design and Crafting Lab", vkey: "mtcrawford", startDate: "2026-08-03", endDate: "2026-08-07", startTime: "13:00", endTime: "16:00", ageMin: 6, ageMax: 12, costCents: 18500, description: "Brick Art, Design and Crafting Lab — a Snapology STEAM & robotics summer camp (ages 6–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 3–Aug 7, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Snapology's STEAM Lab", vkey: "mtcrawford", startDate: "2026-08-10", endDate: "2026-08-14", startTime: "13:00", endTime: "16:00", ageMin: 4, ageMax: 10, costCents: 17500, description: "Snapology's STEAM Lab — a Snapology STEAM & robotics summer camp (ages 4–10) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 10–Aug 14, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Animation Studio", vkey: "mtcrawford", startDate: "2026-08-10", endDate: "2026-08-14", startTime: "13:00", endTime: "16:00", ageMin: 8, ageMax: 14, costCents: 17500, description: "Animation Studio — a Snapology STEAM & robotics summer camp (ages 8–14) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 10–Aug 14, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "KinderBots Robotics", vkey: "mtcrawford", startDate: "2026-08-10", endDate: "2026-08-14", startTime: "09:00", endTime: "12:00", ageMin: 4, ageMax: 7, costCents: 17500, description: "KinderBots Robotics — a Snapology STEAM & robotics summer camp (ages 4–7) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 10–Aug 14, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Super Structures (Architecture)", vkey: "mtcrawford", startDate: "2026-08-10", endDate: "2026-08-14", startTime: "09:00", endTime: "12:00", ageMin: 7, ageMax: 12, costCents: 17500, description: "Super Structures (Architecture) — a Snapology STEAM & robotics summer camp (ages 7–12) at the Mt. Crawford Snapology Workshop (SnapShop!). Aug 10–Aug 14, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Animation Studio 2", vkey: "ducc", startDate: "2026-07-20", endDate: "2026-07-24", startTime: "09:00", endTime: "12:00", ageMin: 8, ageMax: 14, costCents: 17500, description: "Animation Studio 2 — a Snapology STEAM & robotics summer camp (ages 8–14) at the DUCC (Divine Unity Community Church). Jul 20–Jul 24, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "ThinkerBots Robotics", vkey: "mtcrawford", startDate: "2026-07-20", endDate: "2026-07-24", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 9, costCents: 17500, description: "ThinkerBots Robotics — a Snapology STEAM & robotics summer camp (ages 5–9) at the Mt. Crawford Snapology Workshop (SnapShop!). Jul 20–Jul 24, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Superheroes Adventures", vkey: "ducc", startDate: "2026-07-20", endDate: "2026-07-24", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 10, costCents: 17500, description: "Superheroes Adventures — a Snapology STEAM & robotics summer camp (ages 5–10) at the DUCC (Divine Unity Community Church). Jul 20–Jul 24, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Amusement Park Adventures Engineering", vkey: "ducc", startDate: "2026-07-20", endDate: "2026-07-24", startTime: "13:00", endTime: "16:00", ageMin: 8, ageMax: 14, costCents: 17500, description: "Amusement Park Adventures Engineering — a Snapology STEAM & robotics summer camp (ages 8–14) at the DUCC (Divine Unity Community Church). Jul 20–Jul 24, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Pokémania", vkey: "ducc", startDate: "2026-07-20", endDate: "2026-07-24", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Pokémania — a Snapology STEAM & robotics summer camp (ages 5–12) at the DUCC (Divine Unity Community Church). Jul 20–Jul 24, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Video Game Favorites with Robotics", vkey: "ducc", startDate: "2026-07-27", endDate: "2026-07-31", startTime: "13:00", endTime: "16:00", ageMin: 6, ageMax: 12, costCents: 17500, description: "Video Game Favorites with Robotics — a Snapology STEAM & robotics summer camp (ages 6–12) at the DUCC (Divine Unity Community Church). Jul 27–Jul 31, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
  { title: "Mining & Building", vkey: "ducc", startDate: "2026-07-27", endDate: "2026-07-31", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Mining & Building — a Snapology STEAM & robotics summer camp (ages 5–12) at the DUCC (Divine Unity Community Church). Jul 27–Jul 31, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Carnival Creator Robotics", vkey: "ducc", startDate: "2026-07-27", endDate: "2026-07-31", startTime: "09:00", endTime: "12:00", ageMin: 5, ageMax: 9, costCents: 17500, description: "Carnival Creator Robotics — a Snapology STEAM & robotics summer camp (ages 5–9) at the DUCC (Divine Unity Community Church). Jul 27–Jul 31, 2026, Mon–Fri, 9 AM–12 PM. Register through Snapology of Harrisonburg." },
  { title: "Mini-Figure Mania", vkey: "ducc", startDate: "2026-07-27", endDate: "2026-07-31", startTime: "13:00", endTime: "16:00", ageMin: 5, ageMax: 12, costCents: 17500, description: "Mini-Figure Mania — a Snapology STEAM & robotics summer camp (ages 5–12) at the DUCC (Divine Unity Community Church). Jul 27–Jul 31, 2026, Mon–Fri, 1 PM–4 PM. Register through Snapology of Harrisonburg." },
];

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sourceEventIdFor(title: string, vkey: string, startAt: string): string {
  const stamp = new Date(startAt).toISOString().slice(0, 16).replace(/[T:]/g, '');
  return `manual-${slug(title).slice(0, 56)}-${vkey}-${stamp}`;
}

async function main() {
  let manual = (await db.select().from(sources).where(eq(sources.adapterKey, 'manual')))[0];
  if (!manual) {
    [manual] = await db.insert(sources)
      .values({ adapterKey: 'manual', name: 'Manual entries', enabled: false, config: {} })
      .returning();
    console.log(`[snapology] created sources row (${manual!.id})`);
  } else {
    console.log(`[snapology] reusing existing "Manual entries" source (${manual.id})`);
  }

  let inserted = 0;
  for (const e of EVENTS) {
    const v = VENUES[e.vkey];
    if (!v) { console.warn(`  ! unknown venue ${e.vkey} for ${e.title}`); continue; }
    const startAt = `${e.startDate}T${e.startTime}:00${EDT}`;
    const endAt = `${e.endDate}T${e.endTime}:00${EDT}`;
    const sourceEventId = sourceEventIdFor(e.title, e.vkey, startAt);
    await db.insert(activities).values({
      sourceId: manual!.id,
      sourceEventId,
      title: e.title,
      description: e.description,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      timezone: 'America/New_York',
      venueName: v.name,
      address: v.address,
      city: v.city,
      region: v.region,
      country: 'US',
      location: [v.lng, v.lat] as [number, number],
      ageMin: e.ageMin,
      ageMax: e.ageMax,
      costMinCents: e.costCents,
      costMaxCents: e.costCents,
      currency: 'USD',
      availability: 'onsale',
      isVirtual: false,
      organizerName: ORGANIZER_NAME,
      organizerUrl: ORGANIZER_URL,
      organizerKey: ORGANIZER_KEY,
      url: URL,
      imageUrl: null,
      categories: ['education', 'camps'],
      raw: {
        source: 'admin-manual',
        createdBy: 'script:ingest-snapology-summer-camps-2026',
        venue: e.vkey,
        importedAt: new Date().toISOString(),
      },
    }).onConflictDoUpdate({
      target: [activities.sourceId, activities.sourceEventId],
      set: { description: e.description, costMinCents: e.costCents, costMaxCents: e.costCents },
    });
    console.log(`  ~ ${e.startDate}  ${e.startTime}  ${e.title}  @${e.vkey}`);
    inserted++;
  }
  console.log(`[snapology] done — ${inserted} camp sessions across ${Object.keys(VENUES).length} venues`);
  process.exit(0);
}

main().catch((e) => { console.error('[snapology] failed:', e); process.exit(1); });
