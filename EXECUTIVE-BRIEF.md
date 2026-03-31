# Incognito Browser — Programmatic SEO System
## Executive Brief

---

### What Is This?

A system that automatically generates hundreds of high-quality, interactive privacy resource pages for incognitobrowser.io. Instead of manually writing each page, we define **what types of content** we want and **what topics** to cover — then AI generates all the content at once.

**Current output: ~500 pages across 45 privacy topics.**

---

### What Kind of Pages Does It Create?

| Page Type | What It Is | Example |
|-----------|-----------|---------|
| **Checklists** | Interactive to-do lists with checkboxes that save progress | "Browser Privacy Hardening Checklist" |
| **Guides** | Step-by-step how-to tutorials | "Complete Guide to VPN Privacy" |
| **Comparisons** | Side-by-side product comparison tables | "Best Privacy Browsers Compared" |
| **Tools** | Interactive utilities that work in the browser | "Password Strength Checker" |
| **Templates** | Copy-paste document templates users can customize | "GDPR Data Deletion Request Letter" |
| **Calculators** | Interactive calculators with real-time results | "Digital Footprint Risk Calculator" |
| **Glossary** | Privacy/security term definitions | 106 terms from "Ad Blocker" to "Zero Knowledge Proof" |

Every page includes SEO metadata, structured data for Google, and internal links to related content.

---

### Why Does This Matter?

This follows Jake Ward's proven pSEO strategy that grew sites by **466% in 60 days**:

- **Scale**: 500+ pages would take months to write manually. This system generates them in hours.
- **Quality**: Pages aren't thin filler — they have interactive elements, structured data, and real utility.
- **SEO**: Every page targets specific privacy keywords, has proper meta tags, and links back to incognitobrowser.io.
- **Expandable**: Adding a new topic or content type generates dozens of new pages automatically.

---

### How It's Built

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Taxonomy        │────▶│  AI Script   │────▶│  JSON Data      │
│  (45 topics)     │     │  (Claude API) │     │  (500+ files)   │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  Next.js App     │
                                              │  (React pages)   │
                                              └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  Static HTML     │
                                              │  (ready to upload)│
                                              └─────────────────┘
```

1. **Taxonomy** — A master list of 45 privacy topics (VPN, browser privacy, data brokers, etc.)
2. **AI Generation** — A script sends each topic + content type to the Claude API, which returns structured JSON
3. **React Components** — 7 purpose-built page templates (one per content type) render the JSON into interactive pages
4. **Static Export** — Next.js compiles everything into plain HTML files that can be uploaded anywhere

---

### How to Run It

**Location:** `/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo`

#### Preview locally
```bash
cd pseo
npm run dev
# Open http://localhost:3000/resources/
```

#### Generate new content (requires API key)
```bash
cd pseo
export ANTHROPIC_API_KEY="your-key-here"

# Generate everything
npm run generate -- --type all

# Generate one type only
npm run generate -- --type glossary
npm run generate -- --type checklists
npm run generate -- --type guides

# Generate for one topic only
npm run generate -- --type checklists --niche vpn-privacy

# Preview what would be generated (no API calls)
npm run generate:dry -- --type all
```

#### Build for production
```bash
cd pseo
npm run build
# Static files appear in the "out/" folder
# Upload the contents of "out/" to incognitobrowser.io/resources/
```

#### Share a preview with the team
```bash
cd pseo
npm run dev -- -p 3456
lt --port 3456    # creates a public URL anyone can visit
```

---

### How to Add More Content

**Add a new privacy topic:**
1. Open `data/taxonomy.json`
2. Add a new entry to the `niches` array with an id, name, keywords, etc.
3. Run `npm run generate -- --type all --niche your-new-niche-id`
4. Rebuild: `npm run build`

**Add more pages to an existing topic:**
1. Edit the content config in `scripts/generate-content.ts` to add more titles per niche
2. Re-run the generator — it skips existing files, only creates new ones

---

### Key Files

| File/Folder | Purpose |
|------------|---------|
| `data/taxonomy.json` | Master list of all 45 privacy topics |
| `data/checklists/`, `data/guides/`, etc. | Generated JSON content files |
| `components/` | React page templates (one per content type) |
| `app/` | Next.js routes and index pages |
| `scripts/generate-content.ts` | AI content generation script |
| `scripts/schemas/` | JSON schemas that define the structure of each content type |
| `lib/seo.ts` | SEO metadata and structured data helpers |
| `out/` | Production-ready static HTML (after `npm run build`) |

---

### Cost

- **AI generation**: ~$5-15 per full run of 500 pages (Claude API usage)
- **Hosting**: Static HTML — virtually free on any hosting provider
- **Maintenance**: Re-run the generator anytime to add new topics or refresh content

---

### Next Steps

1. **CEO Review** — Preview the pages at the shared URL
2. **Approve** — Confirm content quality and branding
3. **Deploy** — Upload the `out/` folder to incognitobrowser.io/resources/
4. **Submit sitemap** — Add `/resources/sitemap.xml` to Google Search Console
5. **Expand** — Add more niches and content types over time
