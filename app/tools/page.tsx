import Link from 'next/link';
import { getAllContentItems, isPublished, type EditableContent } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT, engineVisibleInThisTier, tierOfEngine, PRO_BASE_URL } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';
import { Badge } from '@/components/ui/Badge';
import { IconTile } from '@/components/ui/Icon';
import { ENGINE_ICON } from '@/lib/visuals';

export const metadata = genMeta({
  title: IS_PRO_DEPLOYMENT ? 'Pro Privacy Tools' : 'Free Privacy Tools',
  description: IS_PRO_DEPLOYMENT
    ? 'Pro privacy tools: cookie & tracker scanner, browser privacy audit, URL safety checker and image metadata viewer. No signup.'
    : 'Free privacy tools that run in your browser: What\'s My IP with WebRTC leak test, password strength checker, secure password generator, hash generator, text encryption, permission checker, user-agent analyzer and a privacy quiz. No signup.',
  path: '/tools',
  type: 'website',
});

interface ToolMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  toolEngine?: string;
  description?: string;
}

// The 17 tool engines with their display info. Icons come from ENGINE_ICON[engine] (lib/visuals).
const FEATURED_TOOLS: { engine: string; title: string; description: string; badge: string; processing?: 'client' | 'server' }[] = [
  {
    engine: 'whats-my-ip',
    title: 'What\'s My IP + WebRTC Leak Test',
    description: 'See the IP address and location every site sees, and check whether WebRTC leaks your real IP around your VPN.',
    badge: 'checker',
    processing: 'server',
  },
  {
    engine: 'password-strength',
    title: 'Password Strength Checker',
    description: 'Analyze any password with entropy calculation, crack time estimation, pattern detection, and character breakdown. Uses the same metrics as professional security tools.',
    badge: 'checker',
  },
  {
    engine: 'browser-privacy',
    title: 'Browser Privacy Audit',
    description: 'Run 14 privacy checks on your browser: Do Not Track, WebRTC leak detection, canvas fingerprinting, device memory exposure, CPU cores, and more.',
    badge: 'analyzer',
  },
  {
    engine: 'text-encryption',
    title: 'Text Encryption Tool',
    description: 'Encrypt and decrypt messages using AES-256-GCM with PBKDF2 key derivation (100k iterations). Military-grade encryption, entirely client-side.',
    badge: 'converter',
  },
  {
    engine: 'cookie-analyzer',
    title: 'Cookie & Tracker Scanner',
    description: 'Scan any website URL for tracking cookies, analytics scripts, and third-party trackers. Identifies Facebook Pixel, Google Analytics, TikTok, and 30+ more.',
    badge: 'scanner',
    processing: 'server',
  },
  {
    engine: 'url-analyzer',
    title: 'URL Safety Checker',
    description: 'Analyze any URL for phishing indicators: suspicious TLDs, homograph attacks, IP-based URLs, URL shorteners, and credential-harvesting patterns.',
    badge: 'checker',
  },
  {
    engine: 'privacy-quiz',
    title: 'Privacy Score Quiz',
    description: '12-question assessment covering browsing, network security, accounts, communication, and devices. Get a letter grade and personalized recommendations.',
    badge: 'calculator',
  },
  {
    engine: 'hash-generator',
    title: 'Cryptographic Hash Generator',
    description: 'Generate SHA-1, SHA-256, SHA-384, and SHA-512 hashes for text or files. Verify file integrity with one-click hash comparison.',
    badge: 'generator',
  },
  {
    engine: 'permission-checker',
    title: 'Permission Checker',
    description: 'Audit which browser permissions (location, camera, microphone, clipboard, sensors) are granted, blocked, or set to prompt.',
    badge: 'checker',
  },
  {
    engine: 'metadata-viewer',
    title: 'Image Metadata Viewer',
    description: 'Upload any JPEG to inspect hidden EXIF data: GPS coordinates, camera model, timestamps, and software info. All processed locally.',
    badge: 'analyzer',
  },
  {
    engine: 'useragent-analyzer',
    title: 'User Agent Analyzer',
    description: 'See exactly what your browser reveals to every website: browser version, OS, device type, rendering engine, and fingerprint factors.',
    badge: 'analyzer',
  },
  {
    engine: 'password-generator',
    title: 'Secure Password Generator',
    description: 'Generate cryptographically random passwords or memorable passphrases using the Web Crypto API (CSPRNG). Configurable length, charset, and format.',
    badge: 'generator',
  },
  {
    engine: 'link-unwrapper',
    title: 'Link Unwrapper',
    description: "Paste any link from an email, ad or post: peel off redirect wrappers, name every tracking ID it carries, and copy a clean version.",
    badge: 'analyzer',
    processing: 'client',
  },
  {
    engine: 'email-pixel-detector',
    title: 'Email Tracking-Pixel Detector',
    description: "Paste an email's source or drop a .eml to reveal hidden open-tracking pixels, click-tracking links and the platform that sent it.",
    badge: 'analyzer',
    processing: 'client',
  },
  {
    engine: 'screenshot-leak-checker',
    title: 'Screenshot Leak Checker',
    description: "Find GPS, embedded thumbnails, device and app names, timestamps and personal data hiding in a screenshot, then download a clean copy.",
    badge: 'analyzer',
    processing: 'client',
  },
  {
    engine: 'dns-leak-test',
    title: 'DNS Leak Test',
    description: "See which DNS resolver really answers your lookups, via our own nameserver, no third parties, and whether it belongs to your ISP.",
    badge: 'checker',
    processing: 'server',
  },
  {
    engine: 'ad-blocker-test',
    title: 'Ad-Blocker Test',
    description: "Fires 50 first-party ad and tracker bait requests at paths generic filter lists block and counts how many your blocker actually stops.",
    badge: 'checker',
    processing: 'client',
  },
];

export default function ToolsIndex() {
  // Listed = this tier's engines AND published: the six drafted quiz duplicates render (noindex) but are not advertised here.
  const items = getAllContentItems<ToolMeta>('tools').filter(i => engineVisibleInThisTier(i.toolEngine) && isPublished(i as unknown as EditableContent));
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));

  // Find the best link for each featured tool. Prefer a PUBLISHED page for the
  // engine; fall back to any page. Without this, drafting a duplicate could leave
  // the featured card pointing at a noindexed page.
  const engineToLink: Record<string, { href: string; niche: string }> = {};
  const orderedItems = [...items].sort(
    (a, b) => Number(isPublished(b as unknown as EditableContent)) - Number(isPublished(a as unknown as EditableContent)),
  );
  for (const item of orderedItems) {
    if (item.toolEngine && !engineToLink[item.toolEngine]) {
      engineToLink[item.toolEngine] = {
        href: `/tools/${item._niche}/${item._slug}`,
        niche: nicheMap[item._niche]?.name || item._niche,
      };
    }
  }


  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">{IS_PRO_DEPLOYMENT ? 'Pro Privacy Tools' : 'Free Privacy Tools'}</h1>
      <p className="text-t2 mb-2">
        Interactive tools to analyze, test, and improve your online privacy.
      </p>
      <p className="text-sm text-t3 mb-8">
        {IS_PRO_DEPLOYMENT ? (
          <>Most tools run entirely in your browser — no data leaves your device. The cookie &amp; tracker scanner is the exception: it fetches the URL you enter through our server (rate-limited, never logged) so it can read what a site sets before you visit. Server-assisted tools are labeled.</>
        ) : (
          <>Every tool here runs in your browser — no data leaves your device — except What&apos;s My IP, which asks our own server what address your request arrived from (never logged). Server-assisted tools are labeled. Looking for the cookie &amp; tracker scanner, browser privacy audit, URL safety checker or image metadata viewer? They live in <a href={`${PRO_BASE_URL}/tools`} className="underline hover:text-white">Incognito Pro →</a>{' '}Want to see how popular sites score? <Link href="/site" className="underline hover:text-white">500 website privacy report cards →</Link></>
        )}
      </p>

      {items.length === 0 && (
        <div className="text-center py-12 text-t3">
          <p className="text-lg">Tools are being generated. Check back soon!</p>
        </div>
      )}

      <AtoZCatalogue
        noun="tools"
        entries={items.map(item => ({
          title: item.title,
          href: `/tools/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          badge: item.toolType,
          keywords: [item.toolEngine, item._niche].filter(Boolean).join(' '),
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/tools/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      >
      {/* Featured tools grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16" data-featured-tools>
        {FEATURED_TOOLS.filter(t => engineVisibleInThisTier(t.engine)).map(tool => {
          const link = engineToLink[tool.engine];
          if (!link) return null;
          const tier = tierOfEngine(tool.engine);
          return (
            <Link
              key={tool.engine}
              href={link.href}
              className="group bg-s0 border border-b1 rounded-lg p-6 hover:border-b2 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <IconTile name={ENGINE_ICON[tool.engine] ?? 'hat'} tone={tier} />
                <Badge label={tool.badge} />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-white/90">
                {tool.title}
              </h3>
              <p className="text-sm text-t2 leading-relaxed">
                {tool.description}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Badge variant={tier} />
                <Badge variant={tool.processing === 'server' ? 'server' : 'client'} />
                <span className="text-meta text-t3">No signup</span>
              </div>
            </Link>
          );
        })}
      </div>
      </AtoZCatalogue>
    </div>
  );
}
