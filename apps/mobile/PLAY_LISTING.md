# Play Store listing — draft

Copy these into Play Console verbatim, or tweak. All text counts within Google's limits.

---

## Basics

- **App name** (≤30 chars): `Proactivity` *(11)*
- **Default language**: English (United States)
- **App or game**: App
- **Free or paid**: Free (in-app purchases later via Plus)
- **Category** (primary): **Events**
- **Category** (secondary, optional): Lifestyle
- **Tags** (up to 5): Events, Local, Activities, Things to do, Weekend
- **Contact email**: `support@proactivity.app` *(set up if not active)*
- **Website**: `https://proactivity.app`
- **Privacy policy URL**: `https://proactivity.app/privacy`

---

## Short description (≤80 chars)

```
Things to do near you, this week. Sortable by time, distance, or price.
```
*(72 chars)*

Alternates:
```
Local events tonight, this weekend, this week — sorted by what's nearby.
```
*(72 chars)*
```
Find walk-up events near you: today, tonight, this weekend. No planning.
```
*(72 chars)*

---

## Full description (≤4000 chars)

```
Find something to do tonight — without scrolling past stuff that already happened or events three months out.

Proactivity is a no-fuss list of things actually happening near you in the next day or two. Filter by category, date range, distance, or price. Sort by what's soonest, nearest, or cheapest. Tap a card to open the organizer's own page where you can register, buy a ticket, or just show up.

WHAT YOU GET
• A live feed of nearby events, refreshed continuously.
• Coverage starting in Harrisonburg and Rockingham County, Virginia, expanding outward.
• Filters: category, today / this week / this month, distance, free-only, search.
• Sort by soonest, nearest, or cheapest.
• Ratings and reviews from people who actually attended.
• Optional sign-in (magic link, no password) to rate events and save your preferences.

BUILT FOR LAST-MINUTE PLANS
Most life isn't booking concert tickets six months out. Most life is "what's happening tonight that I can actually go to?" Proactivity surfaces things you can walk up to without planning — drop-in classes, open gyms, free outdoor events, weekend markets, trivia, music.

LOCATION, PRIVACY-FIRST
We ask for your location so we can sort events by how close they are. We don't store it alongside your account. We don't track you over time. Ads are non-personalized by default — no advertising ID, no behavioral profile.

FREE, AD-SUPPORTED
The app is free. Modest banner ads keep the lights on. A Plus subscription will let you remove them.

FOR EVENT ORGANIZERS
Running events at a brewery, studio, venue, museum, or nonprofit? Submit a single event from any page, or claim your organization to get all your events listed automatically. Listings are free, today and for the foreseeable future. Learn more at proactivity.app/about.

CONTACT
Questions or feedback? proactivity.app/contact
```
*(approx 1820 chars)*

---

## Content rating questionnaire (IARC)

Answer honestly; result will be **Everyone / PEGI 3 / ESRB E** based on the answers below.

- Violence: None
- Sexuality / nudity: None
- Profanity: None (user-generated reviews are moderated)
- Drugs / alcohol / tobacco: None (events listed may include 21+ venues but the app itself is informational)
- Gambling: None
- User interaction: **Yes** — users can post reviews/ratings (moderated)
- Shares user location: **Yes** — for nearby-event sorting
- Digital purchases: **Yes** — Plus subscription planned (set this when you actually wire Stripe; OK to start "No")
- Personal info collected and shared: **No** (we don't share — only Google AdMob receives device-derived data for ad serving)

---

## Target audience

- Age groups: **13 and over** — check **13–15, 16–17, and 18+**. This matches the privacy policy, which sets the floor at 13 ("not directed at children under 13"), and a local-events app realistically appeals to teens.
- **Do NOT select any band under 13** — that triggers Google's Families Policy (COPPA/GDPR-K: certified kid-safe ad SDKs, no advertising ID, separate stricter review). We serve AdMob ads + collect location/email, so staying ≥13 avoids all of it.
- Including 13–17 requires self-certifying that ads are teen-appropriate — already satisfied since we request non-personalized ads by default.
- Appeal to children: No
- (18+ only is also permissible if you specifically don't want teen users, but it's mildly under-inclusive vs. the 13+ privacy policy.)

---

## Data Safety form

Play Console structures this as: declare each data type → for each, answer questions. Below is the full set keyed to what the app actually does.

### Overview answers (top of form)

- **Does your app collect or share any of the required user data types?** Yes
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS for all API calls; AdMob also uses HTTPS)
- **Do you provide a way for users to request that their data is deleted?** Yes (contact form at proactivity.app/contact; 30-day SLA per privacy policy)

### Data types to declare

| Data type | Collected | Shared | Optional/Required | Purposes | Linked to user? | Notes |
|---|---|---|---|---|---|---|
| **Personal info → Email address** | Yes | No | **Optional** | Account management, App functionality | **Yes** | Sign-in via magic link. Optional because the app is fully usable without an account — sign-in is only needed to rate. |
| **Personal info → Name** | Yes | No | Optional | Account management, App functionality | **Yes** | Shown publicly on reviews if provided |
| **Location → Approximate location** | Yes | **Yes** *(with AdMob)* | Optional | App functionality, Advertising | No | Used to sort by distance; AdMob receives IP-derived coarse location |
| **Location → Precise location** | Yes | No | Optional | App functionality | No | From device GPS when permission granted; only sent to our backend at query time, not stored alongside user |
| **App activity → In-app actions** | Yes | No | Required | Analytics, App functionality | No | Anonymous click counters on event cards and category chips |
| **App activity → Other user-generated content** | Yes | No | Optional | App functionality | Yes | Star ratings and review text (moderated) |
| **Device or other IDs → Device or other IDs** | Yes | **Yes** *(with AdMob)* | Required | Advertising | No | AdMob frequency capping. We request non-personalized ads (no AAID for profiling), but Google still uses a limited identifier for ad serving |

### Things we do NOT collect (leave un-checked)

- Financial info (Stripe handles all of this directly — we never see it)
- Health & fitness
- Messages (no in-app messaging)
- Photos & videos
- Audio
- Files & docs
- Calendar / contacts
- Web browsing history
- Sexual orientation / race / etc.
- Search history (within our app — we don't store searches)

### Per-data-type "Why is this data collected?" wording

Use these exact phrases if Play offers free-text fields:

- **Email**: "Required to sign in via one-time magic link and to identify you across sessions."
- **Name**: "Optional. If provided, displayed publicly on any reviews you submit."
- **Approximate location**: "Used in real time to sort and filter events by distance. Also passed to Google AdMob for ad serving."
- **Precise location**: "Used in real time to query nearby events when permission is granted. Not stored alongside your account."
- **In-app actions**: "Anonymous counters on cards and category chips help us rank popular content. Not linked to your identity."
- **Other UGC (ratings)**: "Star ratings and optional review text. Moderated before becoming public."
- **Device or other IDs**: "Used by Google AdMob to serve and frequency-cap banner ads. We request non-personalized ads only."

### Security practices section

- **Data encrypted in transit**: Yes
- **Users can request deletion**: Yes
- **Follows Families Policy**: No (app is for general audience, not specifically kids)
- **Committed to Play's Families Policy**: N/A
- **Independent security review**: No (leave unchecked)

---

## Pre-launch report opt-in

When you upload your first AAB to internal testing, Play runs an automated crawler. Enable it — free, catches obvious crashes/policy issues before review.

---

## What's still to gather (not draftable here)

- 512×512 icon PNG (downsize from the existing 1024×1024)
- Feature graphic 1024×500 PNG (no transparency, app name overlay typically)
- 2-8 phone screenshots (16:9 or 9:16, min 320px short side, max 3840px long side)
- Optional: 7-inch tablet screenshots (1024-7680px), 10-inch tablet screenshots, promo video
- A live `support@proactivity.app` mailbox

Once the verification email arrives from Google Play, the rest is a 30-minute paste session.
