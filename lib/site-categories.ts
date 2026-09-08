/**
 * Site Privacy Report Cards — category assignment.
 *
 * Category drives (a) the index grouping and (b) which pSEO niche a report
 * card cross-links into (the pSEO internal-link rule: every page links into
 * several other content categories). Explicit map for well-known brands,
 * keyword rules for the long tail, 'general' otherwise.
 */
export type SiteCategory =
  | 'news' | 'social' | 'shopping' | 'finance' | 'tech' | 'streaming' | 'travel' | 'health'
  | 'education' | 'government' | 'gaming' | 'dating' | 'email' | 'search' | 'reference' | 'general';

export const CATEGORY_LABEL: Record<SiteCategory, string> = {
  news: 'News & media', social: 'Social networks', shopping: 'Shopping & retail', finance: 'Banking & finance',
  tech: 'Tech & software', streaming: 'Streaming & entertainment', travel: 'Travel & maps', health: 'Health',
  education: 'Education', government: 'Government', gaming: 'Gaming', dating: 'Dating', email: 'Email & messaging',
  search: 'Search engines', reference: 'Reference', general: 'General',
};

/** Which pSEO niche each category cross-links into. All exist in data/taxonomy.json. */
export const CATEGORY_NICHE: Record<SiteCategory, string> = {
  news: 'ad-tracking', social: 'social-media-privacy', shopping: 'online-shopping', finance: 'online-banking',
  tech: 'browser-privacy', streaming: 'ad-tracking', travel: 'location-tracking', health: 'healthcare-privacy',
  education: 'student-privacy', government: 'us-state-privacy', gaming: 'gaming-privacy', dating: 'dating-privacy',
  email: 'email-privacy', search: 'private-search', reference: 'digital-footprint', general: 'cookie-management',
};

const EXPLICIT: Record<string, SiteCategory> = {
  'google.com': 'search', 'bing.com': 'search', 'duckduckgo.com': 'search', 'yahoo.com': 'search', 'baidu.com': 'search', 'yandex.ru': 'search', 'yandex.com': 'search',
  'facebook.com': 'social', 'instagram.com': 'social', 'twitter.com': 'social', 'x.com': 'social', 'linkedin.com': 'social', 'tiktok.com': 'social', 'pinterest.com': 'social', 'reddit.com': 'social', 'snapchat.com': 'social', 'tumblr.com': 'social', 'threads.net': 'social', 'quora.com': 'social', 'vk.com': 'social', 'discord.com': 'social', 'twitch.tv': 'streaming',
  'youtube.com': 'streaming', 'netflix.com': 'streaming', 'spotify.com': 'streaming', 'hulu.com': 'streaming', 'disneyplus.com': 'streaming', 'vimeo.com': 'streaming', 'soundcloud.com': 'streaming', 'primevideo.com': 'streaming', 'max.com': 'streaming', 'roblox.com': 'gaming', 'steampowered.com': 'gaming', 'epicgames.com': 'gaming', 'ea.com': 'gaming', 'playstation.com': 'gaming', 'xbox.com': 'gaming', 'nintendo.com': 'gaming', 'minecraft.net': 'gaming',
  'amazon.com': 'shopping', 'ebay.com': 'shopping', 'walmart.com': 'shopping', 'target.com': 'shopping', 'etsy.com': 'shopping', 'aliexpress.com': 'shopping', 'alibaba.com': 'shopping', 'bestbuy.com': 'shopping', 'costco.com': 'shopping', 'homedepot.com': 'shopping', 'shein.com': 'shopping', 'temu.com': 'shopping', 'ikea.com': 'shopping', 'nike.com': 'shopping', 'apple.com': 'tech', 'shopify.com': 'shopping', 'wayfair.com': 'shopping', 'lowes.com': 'shopping',
  'paypal.com': 'finance', 'chase.com': 'finance', 'bankofamerica.com': 'finance', 'wellsfargo.com': 'finance', 'capitalone.com': 'finance', 'citi.com': 'finance', 'americanexpress.com': 'finance', 'coinbase.com': 'finance', 'binance.com': 'finance', 'robinhood.com': 'finance', 'fidelity.com': 'finance', 'schwab.com': 'finance', 'stripe.com': 'finance', 'intuit.com': 'finance', 'venmo.com': 'finance', 'nerdwallet.com': 'finance',
  'microsoft.com': 'tech', 'github.com': 'tech', 'stackoverflow.com': 'tech', 'adobe.com': 'tech', 'oracle.com': 'tech', 'ibm.com': 'tech', 'salesforce.com': 'tech', 'zoom.us': 'tech', 'slack.com': 'tech', 'dropbox.com': 'tech', 'notion.so': 'tech', 'openai.com': 'tech', 'nvidia.com': 'tech', 'samsung.com': 'tech', 'wordpress.org': 'tech', 'wordpress.com': 'tech', 'mozilla.org': 'tech', 'cloudflare.com': 'tech', 'godaddy.com': 'tech', 'wix.com': 'tech', 'canva.com': 'tech', 'figma.com': 'tech', 'atlassian.com': 'tech', 'medium.com': 'news', 'substack.com': 'news',
  'cnn.com': 'news', 'nytimes.com': 'news', 'bbc.com': 'news', 'bbc.co.uk': 'news', 'foxnews.com': 'news', 'washingtonpost.com': 'news', 'theguardian.com': 'news', 'reuters.com': 'news', 'bloomberg.com': 'news', 'forbes.com': 'news', 'wsj.com': 'news', 'nbcnews.com': 'news', 'cbsnews.com': 'news', 'abcnews.go.com': 'news', 'usatoday.com': 'news', 'dailymail.co.uk': 'news', 'huffpost.com': 'news', 'buzzfeed.com': 'news', 'businessinsider.com': 'news', 'cnbc.com': 'news', 'nypost.com': 'news', 'latimes.com': 'news', 'apnews.com': 'news', 'npr.org': 'news', 'msn.com': 'news', 'yahoo.co.jp': 'news', 'theverge.com': 'news', 'techcrunch.com': 'news', 'wired.com': 'news', 'vice.com': 'news', 'espn.com': 'news',
  'wikipedia.org': 'reference', 'wikimedia.org': 'reference', 'archive.org': 'reference', 'imdb.com': 'reference', 'weather.com': 'reference', 'yelp.com': 'reference', 'tripadvisor.com': 'travel', 'booking.com': 'travel', 'airbnb.com': 'travel', 'expedia.com': 'travel', 'uber.com': 'travel', 'lyft.com': 'travel', 'kayak.com': 'travel', 'hotels.com': 'travel', 'maps.google.com': 'travel',
  'webmd.com': 'health', 'mayoclinic.org': 'health', 'nih.gov': 'health', 'cdc.gov': 'health', 'healthline.com': 'health', 'who.int': 'health',
  'coursera.org': 'education', 'khanacademy.org': 'education', 'udemy.com': 'education', 'edx.org': 'education', 'duolingo.com': 'education', 'mit.edu': 'education', 'harvard.edu': 'education', 'stanford.edu': 'education', 'chegg.com': 'education',
  'irs.gov': 'government', 'usa.gov': 'government', 'gov.uk': 'government', 'europa.eu': 'government', 'nasa.gov': 'government',
  'tinder.com': 'dating', 'bumble.com': 'dating', 'match.com': 'dating', 'hinge.co': 'dating', 'okcupid.com': 'dating',
  'gmail.com': 'email', 'outlook.com': 'email', 'protonmail.com': 'email', 'proton.me': 'email', 'mail.ru': 'email', 'zoho.com': 'email', 'whatsapp.com': 'email', 'telegram.org': 'email', 'signal.org': 'email',
};

const RULES: Array<[RegExp, SiteCategory]> = [
  [/\.gov$|\.gov\.|\.mil$/, 'government'],
  [/\.edu$|\.ac\.|university|college|school/, 'education'],
  [/news|times|post|herald|tribune|journal|daily|gazette|press|guardian|telegraph|mirror|sun|bbc|cnn|nbc|cbs|abc|fox|reuters|bloomberg|forbes|insider|wired|verge|mag|media/, 'news'],
  [/bank|pay|credit|card|finance|invest|capital|trade|coin|crypto|wallet|loan|insur|tax/, 'finance'],
  [/shop|store|mall|buy|cart|deal|market|retail|fashion|wear|outlet|shein|temu|ikea/, 'shopping'],
  [/tube|stream|tv$|video|music|radio|movie|film|play|watch|sport|espn|league/, 'streaming'],
  [/game|gaming|steam|xbox|playstation|nintendo|esports/, 'gaming'],
  [/travel|hotel|flight|air|booking|trip|maps|ride|taxi|rail|cruise/, 'travel'],
  [/health|med|clinic|hospital|pharma|care|drug|fit|diet/, 'health'],
  [/date|dating|match|love|single/, 'dating'],
  [/mail|messag|chat/, 'email'],
  [/search|engine/, 'search'],
  [/wiki|dict|dictionary|encyclopedia|archive|weather|review/, 'reference'],
  [/social|forum|community|reddit|quora|tumblr|pinterest|linkedin|tiktok|instagram|facebook|twitter/, 'social'],
  [/cloud|soft|tech|app|dev|code|git|host|domain|server|data|ai$|\.io$|\.ai$/, 'tech'],
];

export function categorize(host: string): { category: SiteCategory; label: string; niche: string } {
  const h = host.toLowerCase().replace(/^www\./, '');
  let category: SiteCategory = EXPLICIT[h] ?? 'general';
  if (category === 'general') {
    // try registrable domain (drop subdomains)
    const parts = h.split('.');
    const reg = parts.length > 2 ? parts.slice(-2).join('.') : h;
    category = EXPLICIT[reg] ?? 'general';
  }
  if (category === 'general') {
    for (const [re, cat] of RULES) { if (re.test(h)) { category = cat; break; } }
  }
  return { category, label: CATEGORY_LABEL[category], niche: CATEGORY_NICHE[category] };
}
