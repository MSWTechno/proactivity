/**
 * Proactivity wordmark logo. Filled circle (currentColor — inherits from
 * surrounding CSS color) with a white play-triangle inscribed. Visually
 * shifted so the triangle's apex sits at the optical center of the circle.
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
      {/* Right-pointing play triangle. Apex shifted ~1px right of geometric
          center for better optical balance. Slight rounding via stroke-join. */}
      <path
        d="M13 10.5 L22.5 16 L13 21.5 Z"
        fill="#ffffff"
        strokeLinejoin="round"
        strokeLinecap="round"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
