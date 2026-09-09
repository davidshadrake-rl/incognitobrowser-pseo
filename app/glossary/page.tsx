import { getGlossaryFiles, getGlossaryItem } from '@/lib/content';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';
import { PageHero } from '@/components/ui/PageHero';
import { TYPE_ICON } from '@/lib/visuals';

export const metadata = genMeta({
  title: 'Privacy Glossary',
  description: 'A comprehensive glossary of privacy and security terms. Understand the concepts that matter for your online privacy.',
  path: '/glossary',
  type: 'website',
});

interface GlossaryMeta {
  term: string;
  slug: string;
  definition: string;
  category: string;
}

export default function GlossaryIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  const files = getGlossaryFiles();
  const terms: GlossaryMeta[] = files
    .map(f => getGlossaryItem<GlossaryMeta>(f))
    .filter((t): t is GlossaryMeta => t !== null)
    .sort((a, b) => a.term.localeCompare(b.term));


  return (
    <div>
      <PageHero
        icon={TYPE_ICON.glossary}
        kicker="Glossary"
        title="Privacy glossary"
        description="Privacy and security terms explained in plain language, so the jargon stops being the barrier."
        figure={{ value: terms.length, label: 'terms' }}
      />

      {terms.length === 0 && (
        <div className="text-center py-12 text-t3">
          <p className="text-lg">Glossary terms are being generated. Check back soon!</p>
        </div>
      )}

      <AtoZCatalogue
        noun="terms"
        icon={TYPE_ICON.glossary}
        entries={terms.map(term => ({
          title: term.term,
          href: `/glossary/${term.slug}`,
          description: term.definition,
          badge: term.category,
          keywords: term.category,
        }))}
        topics={Array.from(new Set(terms.map(t => t.category))).sort().map(c => ({ label: c, query: c }))}
      />
    </div>
  );
}
