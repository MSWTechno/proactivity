import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lake-anna/conditions
 *
 * Scrapes Dominion Energy's WHTF page for the latest Lake Anna intake
 * temperature, lake level, and plant discharge temperature. Returns JSON
 * with permissive CORS so lakeanna.com (or any partner) can fetch it from
 * the browser without hitting Dominion's site directly.
 *
 * Dominion publishes once per weekday, so we cache aggressively at the
 * Vercel edge (1h fresh, 24h stale-while-revalidate). This keeps actual
 * upstream load to ~1 fetch/hour regardless of partner traffic.
 *
 * Unauthenticated by design — the source data is already public.
 */

const SOURCE_URL =
  'https://www.dominionenergy.com/about/making-energy/nuclear-facilities/north-anna-power-station/waste-heat-treatment-facility';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const CACHE = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};

interface LakeReading {
  date: string; // e.g. "5/20/2026" (as published)
  tempF: number;
  levelFt: number;
}

interface DischargeReading {
  date: string;
  time: string; // e.g. "6:33 a.m."
  tempF: number;
}

function extractCells(rowHtml: string): string[] {
  return Array.from(rowHtml.matchAll(/<td[^>]*>\s*([^<]+?)\s*<\/td>/g)).map((m) => (m[1] ?? '').trim());
}

function parseLake(html: string): LakeReading | null {
  const sec = html.match(/Lake Anna Conditions[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  const tbody = sec?.[1];
  if (!tbody) return null;
  const firstRow = tbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
  const rowHtml = firstRow?.[1];
  if (!rowHtml) return null;
  const [date, tempStr, levelStr] = extractCells(rowHtml);
  if (!date || !tempStr || !levelStr) return null;
  const tempF = parseFloat(tempStr);
  const levelFt = parseFloat(levelStr);
  if (!Number.isFinite(tempF) || !Number.isFinite(levelFt)) return null;
  return { date, tempF, levelFt };
}

function parseDischarge(html: string): DischargeReading | null {
  const sec = html.match(/Discharge Water[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  const tbody = sec?.[1];
  if (!tbody) return null;
  const firstRow = tbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
  const rowHtml = firstRow?.[1];
  if (!rowHtml) return null;
  const [date, time, tempStr] = extractCells(rowHtml);
  if (!date || !time || !tempStr) return null;
  const tempF = parseFloat(tempStr);
  if (!Number.isFinite(tempF)) return null;
  return { date, time, tempF };
}

export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'proactivity.app conditions proxy (https://proactivity.app)',
        Accept: 'text/html',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `dominion upstream returned ${res.status}` },
        { status: 502, headers: CORS },
      );
    }

    const html = await res.text();
    const lake = parseLake(html);
    const discharge = parseDischarge(html);

    if (!lake && !discharge) {
      return NextResponse.json(
        { error: 'failed to parse temperatures from upstream HTML' },
        { status: 502, headers: CORS },
      );
    }

    return NextResponse.json(
      {
        source: SOURCE_URL,
        attribution: 'Dominion Energy — North Anna Waste Heat Treatment Facility',
        fetchedAt: new Date().toISOString(),
        lake,
        discharge,
      },
      { headers: { ...CORS, ...CACHE } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream fetch failed', detail: String(err) },
      { status: 502, headers: CORS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
