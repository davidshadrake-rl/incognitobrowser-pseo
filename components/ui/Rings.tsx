/**
 * Hero background ornament (DESIGN-SPEC section 4): four concentric circles
 * plus a dashed crosshair, t2 stroke at 25% opacity, sitting behind the
 * PageHero content over the brand --accent-gradient. Amendment A leaves this
 * unchanged — the hero band is never tinted by family colour.
 *
 * Server component, purely decorative (aria-hidden).
 */
export function Rings() {
  return (
    <svg
      viewBox="0 0 360 360"
      aria-hidden="true"
      className="pointer-events-none absolute -right-16 -top-20 w-[360px] opacity-25"
    >
      <circle cx="180" cy="180" r="30" stroke="var(--t2)" strokeWidth="1" fill="none" />
      <circle cx="180" cy="180" r="55" stroke="var(--t2)" strokeWidth="1" fill="none" />
      <circle cx="180" cy="180" r="80" stroke="var(--t2)" strokeWidth="1" fill="none" />
      <circle cx="180" cy="180" r="98" stroke="var(--t2)" strokeWidth="1" fill="none" />
      <path d="M180 0v360M0 180h360" stroke="var(--t2)" strokeWidth="1" strokeDasharray="2 6" />
    </svg>
  );
}
