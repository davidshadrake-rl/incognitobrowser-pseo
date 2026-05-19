import { notFound } from 'next/navigation';
import { getAuthor, authorJsonLd, getAllAuthors } from '@/lib/authors';
import { generateMetadata as genMeta, generateBreadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

const SLUG = 'darkpool-david';

export async function generateMetadata(): Promise<Metadata> {
  const author = getAuthor(SLUG);
  if (!author) return {};
  return genMeta({
    title: `${author.name} — ${author.tagline || 'Author'}`,
    description: author.bio.slice(0, 155),
    path: `/authors/${SLUG}`,
    type: 'website',
  });
}

export const dynamicParams = false;
export function generateStaticParams() {
  return getAllAuthors().map((a) => ({ slug: a.slug }));
}

export default function AuthorPage() {
  const author = getAuthor(SLUG);
  if (!author) notFound();

  const breadcrumb = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Authors', url: '/authors' },
    { name: author.name, url: `/authors/${SLUG}` },
  ]);

  const personSchema = {
    '@context': 'https://schema.org',
    ...authorJsonLd(author),
  };

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={personSchema} />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-wide text-[#B8B8D4]">Author</p>
          <h1 className="text-4xl font-bold text-white mt-2">{author.name}</h1>
          {author.tagline && (
            <p className="mt-2 text-lg text-[#B8B8D4]">{author.tagline}</p>
          )}
        </header>

        <section className="prose prose-invert max-w-none">
          <p className="text-lg leading-relaxed text-white/90">{author.bio}</p>

          {author.credentials && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">About this byline</h2>
              <p className="text-white/80">{author.credentials}</p>
            </>
          )}

          {author.areasOfExpertise && author.areasOfExpertise.length > 0 && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">Areas of expertise</h2>
              <ul className="list-disc pl-6 text-white/80">
                {author.areasOfExpertise.map((area) => (
                  <li key={area}>{area}</li>
                ))}
              </ul>
            </>
          )}

          <h2 className="text-xl font-semibold text-white mt-8 mb-2">Why pseudonymous</h2>
          <p className="text-white/80">
            Reporting on browser privacy, surveillance, and tracker
            infrastructure benefits from a writer whose own identity is
            not part of the story. Pseudonymous bylines are an accepted
            practice across privacy and security journalism — what
            matters is consistent authorship, factual accuracy, and a
            verifiable editorial process. Every article on this site
            published under this byline has been reviewed against the
            same editorial gate.
          </p>
        </section>
      </main>
    </>
  );
}
