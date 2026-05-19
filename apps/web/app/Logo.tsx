/**
 * Proactivity wordmark logo. Filled circle (currentColor — inherits from
 * surrounding CSS color) with a forward chevron. The chevron reads as
 * "go" / proactive forward motion, matching the brand idea of being
 * pro at activities AND being proactive about getting out and doing them.
 *
 * Use inline with the wordmark text via `<Logo size={N} />`.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <path
        d="M12 9 L20 16 L12 23"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
