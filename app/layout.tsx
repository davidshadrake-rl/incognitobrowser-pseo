import type { Metadata } from "next";
import Link from "next/link";
import { IncognitoLogo } from "@/components/ui/IncognitoLogo";
import { IS_PRO_DEPLOYMENT } from "@/lib/tiers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Privacy Resources | Incognito Browser",
    template: "%s | Incognito Browser",
  },
  description: "Free privacy tools, checklists, guides, and resources to protect your online privacy.",
  metadataBase: new URL("https://incognitobrowser.io"),
  openGraph: {
    title: "Privacy Resources | Incognito Browser",
    description: "Free privacy tools, checklists, guides, and resources to protect your online privacy.",
    siteName: "Incognito Browser",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Resources | Incognito Browser",
    description: "Free privacy tools, checklists, guides, and resources to protect your online privacy.",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

const navItems = [
  { label: "Checklists", href: "/checklists" },
  { label: "Tools", href: "/tools" },
  { label: "Guides", href: "/guides" },
  { label: "Comparisons", href: "/comparisons" },
  { label: "Glossary", href: "/glossary" },
  { label: "Templates", href: "/templates" },
  { label: "Calculators", href: "/calculators" },
];

// The Pro deployment has no pSEO content — only the Tools section.
const visibleNav = IS_PRO_DEPLOYMENT ? navItems.filter(i => i.href === "/tools") : navItems;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-black text-white font-mono">
        {/* Header */}
        <header className="border-b border-white/10 bg-black sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3 h-16">
              {/* Logo + wordmark. SVG is a React component (see
                  components/ui/IncognitoLogo) so it works regardless of
                  basePath / deploy target — no file-load can fail. */}
              <Link
                href="/"
                className="flex items-center gap-3 min-w-0 shrink-0"
                aria-label="Privacy Resources home"
              >
                <IncognitoLogo size={28} className="rounded" />
                <span className="font-semibold text-white text-sm uppercase tracking-wider whitespace-nowrap">
                  {IS_PRO_DEPLOYMENT ? "Incognito Pro" : "Privacy Resources"}
                </span>
              </Link>
              <nav className="hidden lg:flex items-center gap-1">
                {visibleNav.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-2 text-xs uppercase tracking-wider text-[#B8B8D4] hover:text-white transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <a
                href="https://play.google.com/store/apps/details?id=com.androidbull.incognito.browser&hl=en_US"
                rel="noopener"
                /*
                 * At narrow viewports the text wraps to two lines ("DOWNLOAD" /
                 * "BROWSER") because there isn't horizontal room for one line.
                 * The default btn-primary horizontal padding (1.5rem each side)
                 * makes the resulting two-line pill look unbalanced — wide
                 * pill, narrow text inside.
                 *
                 * !px-4 → 1rem horizontal padding at sm-md (snug around the
                 *         wider word "DOWNLOAD")
                 * md:!px-6 → restores 1.5rem padding at md and up, where the
                 *            text comfortably fits one line and the original
                 *            generous padding looks right.
                 *
                 * leading-tight + text-center keep the two stacked words
                 * vertically symmetric inside the pill.
                 */
                className="btn-primary hidden sm:inline-flex text-xs leading-tight text-center !px-4 md:!px-6"
              >
                Download Browser
              </a>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/10 bg-[#0a0a0a] mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div>
                <h3 className="font-semibold text-white text-xs uppercase tracking-wider mb-4">Resources</h3>
                <ul className="space-y-2 text-sm text-[#B8B8D4]">
                  {visibleNav.map(item => (
                    <li key={item.href}>
                      <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-white text-xs uppercase tracking-wider mb-4">Product</h3>
                <ul className="space-y-2 text-sm text-[#B8B8D4]">
                  <li><a href="https://play.google.com/store/apps/details?id=com.androidbull.incognito.browser&hl=en_US" rel="noopener" className="hover:text-white transition-colors">Download</a></li>
                  <li><a href="https://incognitobrowser.io/news/" rel="noopener" className="hover:text-white transition-colors">Blog</a></li>
                </ul>
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <IncognitoLogo size={28} />
                  <h3 className="font-semibold text-white text-xs uppercase tracking-wider">Incognito Browser</h3>
                </div>
                <p className="text-sm text-[#B8B8D4] leading-relaxed">
                  Free privacy resources provided by Incognito Browser. Protecting your online
                  privacy with tools, guides, and educational content.
                </p>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-white/10 text-center text-xs text-[#B8B8D4]/60">
              &copy; {new Date().getFullYear()} Incognito Browser. All rights reserved.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
