import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
            <div className="flex items-center justify-between h-16">
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src="/icon.svg"
                  alt="Incognito Browser"
                  width={32}
                  height={32}
                  className="rounded"
                />
                <span className="font-semibold text-white text-sm uppercase tracking-wider">Privacy Resources</span>
              </Link>
              <nav className="hidden lg:flex items-center gap-1">
                {navItems.map(item => (
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
                href="https://incognitobrowser.io"
                className="btn-primary hidden sm:inline-flex text-xs"
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
                  {navItems.map(item => (
                    <li key={item.href}>
                      <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-white text-xs uppercase tracking-wider mb-4">Product</h3>
                <ul className="space-y-2 text-sm text-[#B8B8D4]">
                  <li><a href="https://incognitobrowser.io" className="hover:text-white transition-colors">Download</a></li>
                  <li><a href="https://incognitobrowser.io/blog" className="hover:text-white transition-colors">Blog</a></li>
                </ul>
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <Image
                    src="/icon.svg"
                    alt="Incognito Browser"
                    width={28}
                    height={28}
                  />
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
