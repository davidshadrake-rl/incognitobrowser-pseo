/**
 * Illustration system (DESIGN-SPEC section 4). Inline SVG JSX, server
 * component, viewBox 0 0 320 160, at most five shapes each, the .dgm classes
 * from globals.css. Brand blue (.dgm-trace) is only ever the dashed "your
 * data leaving" trace; the `pro` prop adds a `.dgm-block` cut mark across it.
 *
 * Amendment A: each motif's *subject* shape (the phone, the tunnel, the URL
 * bar, the keyed box, the photo card — never the trace or the block mark)
 * takes its family hue via a `dgm-fam-*` class from globals.css. `funnel` has
 * no family — it and every Pro surface stay pro blue (DIAGRAM_FAMILY says
 * so), so its boxes use plain `.dgm-fill` / `var(--pro)` only.
 */
import type { Diagram as DiagramId } from '@/lib/visuals';

export function TrackingDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="Your phone sending data to ad, analytics and social trackers">
      {/* phone: the subject, family stroke (trace) */}
      <rect x="22" y="34" width="52" height="92" rx="8" className="dgm-fill dgm-fam-trace" />
      <rect x="30" y="44" width="36" height="64" rx="3" className="dgm dgm-fam-trace" />
      <path d="M43 117h10" className="dgm dgm-fam-trace" />
      {/* trunk trace out of the phone */}
      <path d="M74 80 H130" className="dgm-trace" />
      {/* branches */}
      <path d="M130 80 C150 80 150 40 172 40" className="dgm-trace" />
      <path d="M130 80 H172" className="dgm-trace" />
      <path d="M130 80 C150 80 150 120 172 120" className="dgm-trace" />
      {/* destinations */}
      <rect x="172" y="24" width="120" height="32" rx="6" className="dgm-fill" />
      <text x="232" y="44" textAnchor="middle" className="dgm-label">ads</text>
      <rect x="172" y="64" width="120" height="32" rx="6" className="dgm-fill" />
      <text x="232" y="84" textAnchor="middle" className="dgm-label">analytics</text>
      <rect x="172" y="104" width="120" height="32" rx="6" className="dgm-fill" />
      <text x="232" y="124" textAnchor="middle" className="dgm-label">social</text>
      {/* Pro: the trace is cut */}
      {pro && <path d="M96 66 L116 94 M116 66 L96 94" className="dgm-block" />}
      <text x="22" y="150" className="dgm-label">you</text>
      <text x="172" y="150" className="dgm-label">who receives it</text>
    </svg>
  );
}

export function LeakDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="A VPN tunnel with a DNS query leaking around it to your ISP">
      {/* tunnel: two rails, family stroke (net) */}
      <path d="M30 60 H230" className="dgm dgm-fam-net" />
      <path d="M30 100 H230" className="dgm dgm-fam-net" />
      {/* your traffic, safe inside the tunnel */}
      <path d="M40 80 H220" className="dgm" />
      {/* one query escapes upward, unencrypted */}
      <path d="M120 80 C120 40 155 40 185 40" className="dgm-trace" />
      <rect x="185" y="24" width="105" height="32" rx="6" className="dgm-fill" />
      <text x="237" y="44" textAnchor="middle" className="dgm-label">your isp</text>
      {pro && <path d="M108 68 L132 92 M132 68 L108 92" className="dgm-block" />}
      <text x="30" y="122" className="dgm-label">vpn tunnel</text>
      <text x="30" y="150" className="dgm-label">you</text>
    </svg>
  );
}

export function FingerprintDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="Six browser attributes bracketed into one fingerprint hash">
      {/* browser window: the subject, family stroke (identity) */}
      <rect x="20" y="28" width="140" height="104" rx="8" className="dgm-fill dgm-fam-identity" />
      <path d="M20 46h140" className="dgm dgm-fam-identity" />
      {/* six attribute bars */}
      <path d="M32 62h60M32 74h80M32 86h45M32 98h70M32 110h50M32 122h60" className="dgm" />
      {/* bracketed into one hash */}
      <path d="M160 80 H190" className="dgm-trace" />
      <rect x="190" y="60" width="100" height="40" rx="6" className="dgm-fill" />
      <text x="240" y="84" textAnchor="middle" className="dgm-label">one hash</text>
      {pro && <path d="M168 66 L184 94 M184 66 L168 94" className="dgm-block" />}
      <text x="20" y="146" className="dgm-label">your browser</text>
    </svg>
  );
}

export function PhishDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="A look-alike URL with the swapped character magnified and underlined">
      {/* URL bar: the subject, family stroke (trace) */}
      <rect x="30" y="54" width="230" height="36" rx="8" className="dgm-fill dgm-fam-trace" />
      <text x="46" y="77" className="dgm-label">paypa1.com</text>
      {/* danger underline under the swapped character */}
      <path d="M122 88h16" className="dgm-block" />
      {/* magnifier lens over it */}
      <circle cx="130" cy="72" r="15" className="dgm" />
      <path d="M141 83l13 13" className="dgm" />
      {pro && <path d="M200 60 L200 84" className="dgm-block" />}
      <text x="30" y="122" className="dgm-label">1, not l</text>
    </svg>
  );
}

export function PixelDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="A hidden 1 by 1 tracking pixel inside an email, magnified, tracing to the sender">
      {/* envelope: the subject, family stroke (trace) */}
      <rect x="24" y="46" width="150" height="90" rx="6" className="dgm-fill dgm-fam-trace" />
      <path d="M24 52l75 50 75-50" className="dgm dgm-fam-trace" />
      {/* the 1x1 pixel, magnified in a lens */}
      <circle cx="150" cy="112" r="17" className="dgm" />
      <circle cx="150" cy="112" r="2" fill="var(--danger)" />
      {/* trace out to the sender */}
      <path d="M167 100 C195 82 215 62 245 50" className="dgm-trace" />
      <rect x="245" y="30" width="65" height="32" rx="6" className="dgm-fill" />
      <text x="277" y="50" textAnchor="middle" className="dgm-label">sender</text>
      {pro && <path d="M196 82 L212 98 M212 82 L196 98" className="dgm-block" />}
    </svg>
  );
}

export function ExifDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="A photo's GPS, date and device tag tracing outward">
      {/* photo card: the subject, family stroke (identity) */}
      <rect x="26" y="28" width="112" height="100" rx="8" className="dgm-fill dgm-fam-identity" />
      <path d="M40 104l24-28 20 18 18-22 26 32" className="dgm dgm-fam-identity" />
      {/* metadata tag */}
      <path d="M138 78 H166" className="dgm-trace" />
      <rect x="166" y="58" width="124" height="40" rx="6" className="dgm-fill" />
      <text x="228" y="82" textAnchor="middle" className="dgm-label">gps . date . device</text>
      {pro && <path d="M144 66 L162 90 M162 66 L144 90" className="dgm-block" />}
      <text x="26" y="146" className="dgm-label">your photo</text>
    </svg>
  );
}

export function CipherDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="Plain text encrypted through a keyed box into scrambled ciphertext">
      {/* plain text bars */}
      <path d="M26 60h70M26 74h50M26 88h60M26 102h40" className="dgm" />
      <path d="M100 80 H140" className="dgm-trace" />
      {/* keyed box: the subject, family stroke (cipher) */}
      <rect x="140" y="55" width="60" height="50" rx="8" className="dgm-fill dgm-fam-cipher" />
      <circle cx="170" cy="72" r="6" className="dgm dgm-fam-cipher" />
      <path d="M170 78v10" className="dgm dgm-fam-cipher" />
      <path d="M200 80 H240" className="dgm-trace" />
      {/* scrambled bars */}
      <path d="M246 60l10 44M262 60l-8 44M280 60l14 44M296 60l-6 44" className="dgm" />
      {pro && <path d="M150 66 L190 94 M190 66 L150 94" className="dgm-block" />}
      <text x="26" y="130" className="dgm-label">plain text</text>
      <text x="246" y="130" className="dgm-label">ciphertext</text>
    </svg>
  );
}

export function FunnelDiagram({ pro = false }: { pro?: boolean }) {
  return (
    <svg viewBox="0 0 320 160" width="100%" role="img" aria-label="Free tools leading to the free app, then to Pro">
      <rect x="16" y="64" width="86" height="32" rx="6" className="dgm-fill" />
      <text x="59" y="84" textAnchor="middle" className="dgm-label">free tools</text>
      <path d="M102 80 H136" className="dgm-trace" />
      <rect x="136" y="64" width="86" height="32" rx="6" className="dgm-fill" />
      <text x="179" y="84" textAnchor="middle" className="dgm-label">free app</text>
      <path d="M222 80 H256" className="dgm-trace" />
      <rect x="256" y="64" width="48" height="32" rx="6" fill="var(--pro-dim)" stroke="var(--pro)" strokeWidth="1.25" />
      <text x="280" y="84" textAnchor="middle" className="dgm-label">pro</text>
      {pro && <path d="M262 66 L298 94 M298 66 L262 94" className="dgm-block" />}
    </svg>
  );
}

const MOTIFS: Record<DiagramId, (props: { pro?: boolean }) => React.JSX.Element> = {
  tracking: TrackingDiagram,
  leak: LeakDiagram,
  fingerprint: FingerprintDiagram,
  phish: PhishDiagram,
  pixel: PixelDiagram,
  exif: ExifDiagram,
  cipher: CipherDiagram,
  funnel: FunnelDiagram,
};

/** Looks up the motif by id (lib/visuals `Diagram` type). `pro` adds the
 * `.dgm-block` cut mark; the funnel motif ignores it visually (it has no
 * trace to cut) but still accepts the prop for a uniform call site. */
export function Diagram({ id, pro = false }: { id: DiagramId; pro?: boolean }) {
  const Motif = MOTIFS[id];
  return <Motif pro={pro} />;
}
