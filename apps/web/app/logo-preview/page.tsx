/**
 * Temporary logo design preview page. Renders 6 candidate logos at
 * multiple sizes so we can pick a favorite. Delete this directory
 * once the choice is locked in.
 */
import Link from 'next/link';

const CONCEPTS = [
  {
    id: 'current',
    name: '0. Current — Play triangle',
    rationale: 'Today\'s logo. Generic "play" affordance.',
  },
  {
    id: 'chevron',
    name: '1. Forward chevron',
    rationale: 'Single rightward chevron in a circle. Reads as "go" / proactive forward motion. Geometric and reads cleanly at favicon size.',
  },
  {
    id: 'stride',
    name: '2. Stride',
    rationale: 'Abstract figure mid-stride. Strongest "go out and do" connotation. More illustrative than the geometric options.',
  },
  {
    id: 'parrow',
    name: '3. P-arrow wordmark',
    rationale: 'Letter P where the bowl terminates in an arrowhead. Ties brand name to the "pro" + forward motion idea.',
  },
  {
    id: 'spark',
    name: '4. Spark',
    rationale: 'Four-point sparkle/burst. Energy + initiative. Versatile, doesn\'t pin the brand to any one activity type.',
  },
  {
    id: 'calbolt',
    name: '5. Calendar-bolt',
    rationale: 'Calendar grid with a lightning bolt on one date. "Plans into action" — the proactive choice on the calendar.',
  },
  {
    id: 'compass',
    name: '6. Compass needle',
    rationale: 'Compass / arrow rosette. "Find your way out and do things." Slightly more outdoor-adventure leaning.',
  },
] as const;

type ConceptId = (typeof CONCEPTS)[number]['id'];

function LogoConcept({ id, size = 32, fg = 'currentColor', bg = 'transparent' }: {
  id: ConceptId;
  size?: number;
  fg?: string;
  bg?: string;
}) {
  const inner = (() => {
    switch (id) {
      case 'current':
        return (
          <>
            <circle cx="16" cy="16" r="16" fill={fg} />
            <path d="M13 10.5 L22.5 16 L13 21.5 Z" fill="#fff" />
          </>
        );

      case 'chevron':
        return (
          <>
            <circle cx="16" cy="16" r="16" fill={fg} />
            <path
              d="M12 9 L20 16 L12 23"
              fill="none"
              stroke="#fff"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );

      case 'stride':
        return (
          <>
            <circle cx="16" cy="16" r="16" fill={fg} />
            {/* head */}
            <circle cx="20" cy="8" r="2.2" fill="#fff" />
            {/* body + striding legs + swinging arm, abstract */}
            <path
              d="M19 11 L15 18 L12 23 M19 11 L21 17 L24 22 M15 18 L20 17 M19 11 L23 14"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        );

      case 'parrow':
        return (
          <>
            {/* P-shape stem */}
            <path
              d="M8 5 L8 27"
              stroke={fg}
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* P bowl — open right, terminates in an arrowhead */}
            <path
              d="M8 7 L18 7 Q24 7 24 13 Q24 19 18 19 L8 19"
              fill="none"
              stroke={fg}
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* arrowhead at end of bowl */}
            <path
              d="M15 16 L18 19 L15 22"
              fill="none"
              stroke={fg}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );

      case 'spark':
        return (
          <>
            <circle cx="16" cy="16" r="16" fill={fg} />
            {/* 4-point sparkle: vertical + horizontal diamonds meeting at center */}
            <path
              d="M16 4 Q17 14 22 16 Q17 18 16 28 Q15 18 10 16 Q15 14 16 4 Z"
              fill="#fff"
            />
          </>
        );

      case 'calbolt':
        return (
          <>
            {/* binder tabs */}
            <rect x="10" y="3" width="2.5" height="4" rx="1" fill={fg} />
            <rect x="19.5" y="3" width="2.5" height="4" rx="1" fill={fg} />
            {/* calendar body */}
            <rect x="4" y="6" width="24" height="22" rx="3" fill={fg} />
            {/* header strip */}
            <rect x="4" y="6" width="24" height="5" rx="3" fill={fg} />
            <rect x="4" y="9" width="24" height="2" fill={fg} />
            {/* lightning bolt cutout */}
            <path
              d="M17 13 L11 21 L15 21 L13 26 L20 17 L16 17 L18 13 Z"
              fill="#fff"
            />
          </>
        );

      case 'compass':
        return (
          <>
            <circle cx="16" cy="16" r="16" fill={fg} />
            {/* north arrow (white) */}
            <path d="M16 5 L12 18 L16 16 L20 18 Z" fill="#fff" />
            {/* south arrow (faded) */}
            <path d="M16 27 L12 14 L16 16 L20 14 Z" fill="#fff" opacity="0.4" />
            {/* center dot */}
            <circle cx="16" cy="16" r="1.5" fill={fg} />
          </>
        );
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style={{ background: bg }}>
      {inner}
    </svg>
  );
}

export default function LogoPreviewPage() {
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <Link href="/" style={{ fontSize: 13 }}>← Back to events</Link>
      <h1 style={{ marginTop: 16 }}>Logo concepts</h1>
      <p style={{ color: '#666', maxWidth: 640 }}>
        Each row shows the logo at three sizes (16 / 28 / 64 px), then on a dark
        background, then as a wordmark. Pick the one you want and tell me the
        number — I'll wire it up as the real <code>Logo</code> component and
        replace the favicon.
      </p>

      {CONCEPTS.map((c) => (
        <section
          key={c.id}
          style={{
            border: '1px solid #e5e5ea',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            background: '#fff',
            color: '#222',
          }}
        >
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>{c.name}</h2>
          </header>
          <p style={{ fontSize: 13, color: '#666', margin: '6px 0 14px', maxWidth: 640 }}>
            {c.rationale}
          </p>

          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* sizes (purple) */}
            <div style={{ color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 12 }}>
              <LogoConcept id={c.id} size={16} />
              <LogoConcept id={c.id} size={28} />
              <LogoConcept id={c.id} size={64} />
            </div>

            {/* on dark */}
            <div style={{ background: '#111', padding: '14px 18px', borderRadius: 8, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
              <LogoConcept id={c.id} size={28} />
              <span style={{ fontWeight: 600 }}>proactivity</span>
            </div>

            {/* wordmark on light */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6d28d9' }}>
              <LogoConcept id={c.id} size={32} />
              <span style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-0.01em' }}>proactivity</span>
            </div>
          </div>
        </section>
      ))}

      <p style={{ color: '#666', fontSize: 13, marginTop: 24 }}>
        Once you pick, I'll: (1) replace <code>apps/web/app/Logo.tsx</code> with
        the chosen SVG, (2) regenerate <code>apps/web/app/icon.svg</code> so
        the browser tab favicon matches, and (3) delete this preview page.
      </p>
    </main>
  );
}
