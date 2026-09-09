import Link from 'next/link';
import { getAllContentItems, isPublished, type EditableContent } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT, engineVisibleInThisTier, PRO_ENGINES, PRO_BASE_URL, FREE_BASE_URL } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';
import { ToolCard } from '@/components/ToolCard';
import { PageHero } from '@/components/ui/PageHero';
import { PhoneFrame } from '@/components/ui/PhoneFrame';

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

// The 17 tool engines with their display info (DESIGN-SPEC 5.3). Icons come
// from ENGINE_ICON[engine] (lib/visuals); blurbs are the "what it checks,
// where it runs" pattern, capped at 120 chars.
const FEATURED_TOOLS: { engine: string; title: string; blurb: string; processing?: 'client' | 'server' }[] = [
  {
    engine: 'whats-my-ip',
    title: 'What\'s My IP + WebRTC Leak Test',
    blurb: 'The address every site sees, and whether WebRTC leaks your real one around your VPN. Asks our server once.',
    processing: 'server',
  },
  {
    engine: 'password-strength',
    title: 'Password Strength Checker',
    blurb: 'Entropy, crack time and the patterns attackers try first. Runs in your browser; nothing is sent.',
  },
  {
    engine: 'browser-privacy',
    title: 'Browser Privacy Audit',
    blurb: '14 checks: Do Not Track, WebRTC, canvas fingerprint, device memory, cores and more. Runs in your browser.',
  },
  {
    engine: 'text-encryption',
    title: 'Text Encryption Tool',
    blurb: 'AES-256-GCM with a PBKDF2 key, 100k iterations. Encrypts and decrypts in your browser.',
  },
  {
    engine: 'cookie-analyzer',
    title: 'Cookie & Tracker Scanner',
    blurb: 'Cookies, analytics scripts and 30+ tracker signatures a site sets before you consent. Fetched via our server.',
    processing: 'server',
  },
  {
    engine: 'url-analyzer',
    title: 'URL Safety Checker',
    blurb: 'Phishing marks in any link: odd TLDs, look-alike letters, raw IPs, shorteners, credential bait. In your browser.',
  },
  {
    engine: 'privacy-quiz',
    title: 'Privacy Score Quiz',
    blurb: '12 questions on browsing, network, accounts, messaging and devices. A letter grade, in your browser.',
  },
  {
    engine: 'hash-generator',
    title: 'Cryptographic Hash Generator',
    blurb: 'MD5, SHA-1, SHA-256 and SHA-512 of any text. Computed in your browser.',
  },
  {
    engine: 'permission-checker',
    title: 'Permission Checker',
    blurb: 'Which of 11 permissions this browser grants: camera, mic, location, notifications and more. In your browser.',
  },
  {
    engine: 'metadata-viewer',
    title: 'Image Metadata Viewer',
    blurb: 'GPS, date, device and every EXIF tag inside a photo. Read in your browser; the file never uploads.',
  },
  {
    engine: 'useragent-analyzer',
    title: 'User Agent Analyzer',
    blurb: 'What your user-agent string tells sites about your device, OS and browser. In your browser.',
  },
  {
    engine: 'password-generator',
    title: 'Secure Password Generator',
    blurb: 'Random passwords and passphrases from your browser\'s own randomness. Nothing is sent.',
  },
  {
    engine: 'link-unwrapper',
    title: 'Link Unwrapper',
    blurb: 'Where a shortened or tracking link really goes, and which parameters follow you. In your browser.',
    processing: 'client',
  },
  {
    engine: 'email-pixel-detector',
    title: 'Email Tracking-Pixel Detector',
    blurb: 'Hidden 1x1 tracking pixels in an email\'s HTML source. Pasted and parsed in your browser.',
    processing: 'client',
  },
  {
    engine: 'screenshot-leak-checker',
    title: 'Screenshot Leak Checker',
    blurb: 'Names, emails, addresses and tokens visible in a screenshot before you share it. In your browser.',
    processing: 'client',
  },
  {
    engine: 'dns-leak-test',
    title: 'DNS Leak Test',
    blurb: 'Whether your DNS queries escape your VPN to your ISP. Uses our resolver to see who asks.',
    processing: 'server',
  },
  {
    engine: 'ad-blocker-test',
    title: 'Ad-Blocker Test',
    blurb: '50 bait requests that mimic ad and tracker domains; counts what your blocker lets through. In your browser.',
    processing: 'client',
  },
];

// The four most-trafficked engines per tier get the 56px instrument-panel treatment.
const INSTRUMENT_ENGINES = IS_PRO_DEPLOYMENT
  ? ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer']
  : ['whats-my-ip', 'password-strength', 'dns-leak-test', 'ad-blocker-test'];

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

  // The free-site Pro band links at the Pro deployment even though this build
  // never renders Pro-engine pages itself — so it is built from the FULL,
  // untiered catalogue (never engineVisibleInThisTier, which would filter
  // every Pro engine straight out).
  const proEngineToLink: Record<string, string> = {};
  if (!IS_PRO_DEPLOYMENT) {
    const allTools = getAllContentItems<ToolMeta>('tools');
    const orderedAll = [...allTools].sort(
      (a, b) => Number(isPublished(b as unknown as EditableContent)) - Number(isPublished(a as unknown as EditableContent)),
    );
    for (const item of orderedAll) {
      if (item.toolEngine && PRO_ENGINES.has(item.toolEngine) && !proEngineToLink[item.toolEngine]) {
        proEngineToLink[item.toolEngine] = `${PRO_BASE_URL}/tools/${item._niche}/${item._slug}`;
      }
    }
  }

  const lede = IS_PRO_DEPLOYMENT
    ? "The web versions of Incognito Pro's tools. No account, no charge today."
    : 'Every tool runs in your browser except the two marked server-assisted, which ask our server once and never log. No account.';

  return (
    <div>
      <PageHero
        icon="hat"
        kicker="Tools"
        title={IS_PRO_DEPLOYMENT ? 'Pro tools' : 'Free privacy tools'}
        description={lede}
        figure={{ value: items.length, label: 'tools' }}
        diagram="funnel"
        tier={IS_PRO_DEPLOYMENT ? 'pro' : 'free'}
        aside={
          <p className="text-meta text-t3 mt-2">
            {IS_PRO_DEPLOYMENT ? (
              <>Free tools on <a href={`${FREE_BASE_URL}/tools`} className="underline hover:text-t1">the main site &rarr;</a></>
            ) : (
              <>See how sites score: <Link href="/site" className="underline hover:text-t1">500 website privacy report cards &rarr;</Link></>
            )}
          </p>
        }
      />

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
          keywords: [
            item.toolEngine,
            item._niche,
            FEATURED_TOOLS.find(t => t.engine === item.toolEngine)?.processing === 'server' ? 'server-assisted' : 'client-only',
          ].filter(Boolean).join(' '),
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/tools/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      >
      {/* Instrument panel: the four most-trafficked engines, with the input -> check -> verdict schematic */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8" data-instrument-panel>
        {INSTRUMENT_ENGINES.map(engine => {
          const tool = FEATURED_TOOLS.find(t => t.engine === engine);
          const link = engineToLink[engine];
          if (!tool || !link) return null;
          return (
            <ToolCard key={engine} engine={engine} title={tool.title} blurb={tool.blurb} href={link.href} processing={tool.processing} tileSize={56} schematic />
          );
        })}
      </div>

      {/* The remaining featured tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-16" data-featured-tools>
        {FEATURED_TOOLS.filter(t => engineVisibleInThisTier(t.engine) && !INSTRUMENT_ENGINES.includes(t.engine)).map(tool => {
          const link = engineToLink[tool.engine];
          if (!link) return null;
          return (
            <ToolCard key={tool.engine} engine={tool.engine} title={tool.title} blurb={tool.blurb} href={link.href} processing={tool.processing} />
          );
        })}
      </div>

      {/* TierCompare goes here in PR4 (DESIGN-SPEC 6.2) */}

      {!IS_PRO_DEPLOYMENT && (
        <div
          className="relative overflow-hidden grid lg:grid-cols-[1fr_200px] gap-6 bg-s0 border border-b1 rounded-[16px] p-6 mb-16 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-pro"
          data-pro-band
        >
          <div className="min-w-0">
            <h2 className="font-mono text-h2 font-semibold text-t1 mb-4">Four Pro tools, on the web, free for now</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[...PRO_ENGINES].map(engine => {
                const tool = FEATURED_TOOLS.find(t => t.engine === engine);
                const href = proEngineToLink[engine];
                if (!tool || !href) return null;
                return (
                  <ToolCard key={engine} engine={engine} title={tool.title} blurb={tool.blurb} href={href} processing={tool.processing} />
                );
              })}
            </div>
          </div>
          <div className="hidden lg:flex items-center justify-center">
            <PhoneFrame />
          </div>
        </div>
      )}
      </AtoZCatalogue>
    </div>
  );
}
