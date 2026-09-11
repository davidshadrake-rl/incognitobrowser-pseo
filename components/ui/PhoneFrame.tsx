/**
 * Product graphic (DESIGN-SPEC section 4): a 150x300 phone, rx24, 2px b2
 * stroke, 6px s0 ring, speaker slot, screen s0 rx10 with a pro header band
 * reading "Incognito PRO" and three rows (VPN, Trackers, Audit) with pro
 * bars. Sits beside ResultCta and in the /tools Pro band. Server component.
 *
 * Decorative: hidden from assistive tech, and it shows no number. It used to
 * read "Audit · 92/100", which sat beside the visitor's real score in
 * ResultCta and read as a second result. Both callers caption it
 * "Incognito Pro on Android (illustration)".
 */
export function PhoneFrame() {
  return (
    <svg viewBox="0 0 150 300" width="150" height="300" aria-hidden="true" focusable="false">
      {/* body: 2px b2 stroke, 6px s0 ring */}
      <rect x="3" y="3" width="144" height="294" rx="24" fill="var(--s0)" stroke="var(--b2)" strokeWidth="2" />
      <rect x="9" y="9" width="132" height="282" rx="18" fill="var(--base)" />
      {/* speaker slot */}
      <rect x="60" y="17" width="30" height="4" rx="2" fill="var(--b1)" />
      {/* screen */}
      <rect x="15" y="30" width="120" height="252" rx="10" fill="var(--s0)" />
      {/* pro header band */}
      <rect x="15" y="30" width="120" height="28" rx="10" fill="var(--pro)" />
      <rect x="15" y="44" width="120" height="14" fill="var(--pro)" />
      <text x="75" y="48" textAnchor="middle" fill="var(--base)" className="text-meta font-semibold">
        Incognito PRO
      </text>
      {/* rows */}
      <text x="24" y="86" fill="var(--t2)" className="text-row">
        VPN · on
      </text>
      <rect x="24" y="94" width="102" height="4" rx="2" fill="var(--pro)" />
      <text x="24" y="122" fill="var(--t2)" className="text-row">
        Trackers · blocked
      </text>
      <rect x="24" y="130" width="102" height="4" rx="2" fill="var(--pro)" />
      <text x="24" y="158" fill="var(--t2)" className="text-row">
        Audit · ready
      </text>
      <rect x="24" y="166" width="102" height="4" rx="2" fill="var(--pro)" />
    </svg>
  );
}
