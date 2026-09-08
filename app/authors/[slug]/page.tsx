import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getAuthor, authorJsonLd, getAllAuthors } from '@/lib/authors';
import { generateMetadata as genMeta, generateBreadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return [{ slug: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
  return getAllAuthors().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) return {};
  return genMeta({
    title: `${author.name} — ${author.tagline || 'Author'}`,
    description: author.bio.slice(0, 155),
    path: `/authors/${slug}`,
    type: 'website',
  });
}

export default async function AuthorPage({ params }: PageProps) {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) notFound();

  const editor = author.editorSlug ? getAuthor(author.editorSlug) : null;

  const breadcrumb = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Authors', url: '/authors' },
    { name: author.name, url: `/authors/${slug}` },
  ]);

  const personSchema = {
    '@context': 'https://schema.org',
    ...authorJsonLd(author),
  };

  const isWriter = author.role === 'writer' || !author.role;
  const isEditor = author.role === 'editor';

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={personSchema} />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-wide text-[#B8B8D4]">
            {isEditor ? 'Editor' : 'Author'}
          </p>
          <h1 className="text-4xl font-bold text-white mt-2">{author.name}</h1>
          {author.tagline && (
            <p className="mt-2 text-lg text-[#B8B8D4]">{author.tagline}</p>
          )}
        </header>

        <section className="prose prose-invert max-w-none">
          <p className="text-lg leading-relaxed text-white/90">{author.bio}</p>

          {author.credentials && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">
                {isEditor ? 'About the editor' : 'About this byline'}
              </h2>
              <p className="text-white/80">{author.credentials}</p>
            </>
          )}

          {author.sameAs && author.sameAs.length > 0 && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">Verified profiles</h2>
              <ul className="list-disc pl-6 text-white/80">
                {author.sameAs.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      rel="me noopener"
                      target="_blank"
                      className="underline text-white/90 hover:text-white"
                    >
                      {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  </li>
                ))}
              </ul>
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

          {editor && isWriter && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">Edited by</h2>
              <p className="text-white/80">
                Content under this byline is reviewed by{' '}
                <a
                  href={`/authors/${editor.slug}`}
                  className="underline text-white/90 hover:text-white"
                >
                  {editor.name}
                </a>
                , the named editor responsible for the resource library's
                editorial standards.
              </p>
            </>
          )}

          {isWriter && (
            <>
              <h2 className="text-xl font-semibold text-white mt-8 mb-2">Why pseudonymous</h2>
              <p className="text-white/80">
                Reporting on browser privacy, surveillance, and tracker
                infrastructure benefits from a writer whose own identity is
                not part of the story. Pseudonymous bylines are an accepted
                practice across privacy and security journalism — what
                matters is consistent authorship, factual accuracy, and a
                verifiable editorial process.{' '}
                {editor && `Every article published under this byline has been reviewed by ${editor.name}.`}
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
