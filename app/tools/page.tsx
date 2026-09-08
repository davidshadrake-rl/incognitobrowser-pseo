import Link from 'next/link';
import { getAllContentItems, isPublished, type EditableContent } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT, engineVisibleInThisTier, tierOfEngine } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: IS_PRO_DEPLOYMENT ? 'Pro Privacy Tools' : 'Free Privacy Tools',
  description: 'Free interactive privacy tools: password checker, browser fingerprint audit, text encryption, URL safety scanner, and more. All run client-side.',
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

// The 11 unique tool engines with their display info
const FEATURED_TOOLS: { engine: string; icon: string; title: string; description: string; badge: string; processing?: 'client' | 'server' }[] = [
  {
    engine: 'password-strength',
    icon: '🔐',
    title: 'Password Strength Checker',
    description: 'Analyze any password with entropy calculation, crack time estimation, pattern detection, and character breakdown. Uses the same metrics as professional security tools.',
    badge: 'checker',
  },
  {
    engine: 'browser-privacy',
    icon: '🛡️',
    title: 'Browser Privacy Audit',
    description: 'Run 14 privacy checks on your browser: Do Not Track, WebRTC leak detection, canvas fingerprinting, device memory exposure, CPU cores, and more.',
    badge: 'analyzer',
  },
  {
    engine: 'text-encryption',
    icon: '🔒',
    title: 'Text Encryption Tool',
    description: 'Encrypt and decrypt messages using AES-256-GCM with PBKDF2 key derivation (100k iterations). Military-grade encryption, entirely client-side.',
    badge: 'converter',
  },
  {
    engine: 'cookie-analyzer',
    icon: '🍪',
    title: 'Cookie & Tracker Scanner',
    description: 'Scan any website URL for tracking cookies, analytics scripts, and third-party trackers. Identifies Facebook Pixel, Google Analytics, TikTok, and 30+ more.',
    badge: 'scanner',
    processing: 'server',
  },
  {
    engine: 'url-analyzer',
    icon: '🔗',
    title: 'URL Safety Checker',
    description: 'Analyze any URL for phishing indicators: suspicious TLDs, homograph attacks, IP-based URLs, URL shorteners, and credential-harvesting patterns.',
    badge: 'checker',
  },
  {
    engine: 'privacy-quiz',
    icon: '📊',
    title: 'Privacy Score Quiz',
    description: '12-question assessment covering browsing, network security, accounts, communication, and devices. Get a letter grade and personalized recommendations.',
    badge: 'calculator',
  },
  {
    engine: 'hash-generator',
    icon: '#️⃣',
    title: 'Cryptographic Hash Generator',
    description: 'Generate SHA-1, SHA-256, SHA-384, and SHA-512 hashes for text or files. Verify file integrity with one-click hash comparison.',
    badge: 'generator',
  },
  {
    engine: 'permission-checker',
    icon: '📱',
    title: 'Permission Checker',
    description: 'Audit which browser permissions (location, camera, microphone, clipboard, sensors) are granted, blocked, or set to prompt.',
    badge: 'checker',
  },
  {
    engine: 'metadata-viewer',
    icon: '📷',
    title: 'Image Metadata Viewer',
    description: 'Upload any JPEG to inspect hidden EXIF data: GPS coordinates, camera model, timestamps, and software info. All processed locally.',
    badge: 'analyzer',
  },
  {
    engine: 'useragent-analyzer',
    icon: '🌐',
    title: 'User Agent Analyzer',
    description: 'See exactly what your browser reveals to every website: browser version, OS, device type, rendering engine, and fingerprint factors.',
    badge: 'analyzer',
  },
  {
    engine: 'password-generator',
    icon: '🎲',
    title: 'Secure Password Generator',
    description: 'Generate cryptographically random passwords or memorable passphrases using the Web Crypto API (CSPRNG). Configurable length, charset, and format.',
    badge: 'generator',
  },
];

export default function ToolsIndex() {
  const items = getAllContentItems<ToolMeta>('tools').filter(i => engineVisibleInThisTier(i.toolEngine));
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
      <p className="text-[#B8B8D4] mb-2">
        Interactive tools to analyze, test, and improve your online privacy.
      </p>
      <p className="text-sm text-[#B8B8D4]/60 mb-8">
        Most tools run entirely in your browser — no data leaves your device. The
        cookie &amp; tracker scanner is the exception: it fetches the URL you enter
        through our server (rate-limited, never logged) so it can read what a site
        sets before you visit. Server-assisted tools are labeled.{' '}
        {!IS_PRO_DEPLOYMENT && (<>Want to see how popular sites score? <Link href="/site" className="underline hover:text-white">500 website privacy report cards →</Link></>)}
      </p>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
        {FEATURED_TOOLS.filter(t => engineVisibleInThisTier(t.engine)).map(tool => {
          const link = engineToLink[tool.engine];
          if (!link) return null;
          return (
            <Link
              key={tool.engine}
              href={link.href}
              className="group bg-[#0a0a0a] border border-white/10 rounded-lg p-6 hover:border-white/25 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">{tool.icon}</span>
                <span className="text-xs px-2 py-0.5 bg-white/10 rounded text-[#B8B8D4]">{tool.badge}</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-white/90">
                {tool.title}
              </h3>
              <p className="text-sm text-[#B8B8D4] leading-relaxed">
                {tool.description}
              </p>
              <div className="mt-4 flex items-center gap-1 text-xs text-[#B8B8D4]/60">
                <span className="text-green-400/60">●</span>
                <span>{tierOfEngine(tool.engine) === 'pro' ? 'Pro' : 'Free'}</span>
                <span className="mx-1">·</span>
                <span>{tool.processing === 'server' ? 'Server-assisted' : 'Client-side'}</span>
                <span className="mx-1">·</span>
                <span>No signup</span>
              </div>
            </Link>
          );
        })}
      </div>
      </AtoZCatalogue>
    </div>
  );
}
