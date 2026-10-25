import Link from 'next/link';
import { Card, Section } from '@/components/site/ui';
import { POSTS } from '@/data/story';

/**
 * The build-story index: a vertical timeline of the five diary-style posts,
 * plus call-outs into the roadmap and changelog.
 */
export default function StoryPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-16 px-4 py-10 sm:px-6 sm:py-14">
      <Section kicker="The build story" title="From a whiteboard gap to a working gate">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          How Veylqorix came to be, told the way it happened: the problem that
          started it, the eight-day board, the principle that holds it
          together, the architecture underneath, and the process that shipped
          it. Five posts, in order.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link href="/roadmap" className="btn-secondary">
            See the eight-day roadmap
          </Link>
          <Link href="/changelog" className="btn-secondary">
            Read the changelog
          </Link>
        </div>
      </Section>

      <section aria-label="Story posts">
        <ol className="relative space-y-8 border-l-4 border-line pl-6 sm:pl-8">
          {POSTS.map((post, i) => (
            <li key={post.slug} className="relative">
              <span
                className="absolute -left-[35px] top-1.5 grid h-6 w-6 place-items-center rounded border-4 border-line bg-navy sm:-left-[43px]"
                aria-hidden="true"
              >
                <span className="pixel-label-sm text-mint">{String(i + 1).padStart(2, '0')}</span>
              </span>
              <Link href={`/story/${post.slug}`} className="pixel-box press block p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="pixel-label-sm rounded bg-surface-2 px-2 py-1 text-navy">
                    {post.tag}
                  </span>
                  <span className="pixel-label-sm text-ink-dim">{post.date}</span>
                </div>
                <h2 className="mt-3 text-xl font-extrabold tracking-tight text-navy sm:text-2xl">
                  {post.title}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">{post.summary}</p>
                <p className="pixel-label-sm mt-4 text-teal-deep">Read the post →</p>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <Section kicker="Where the story lives" title="More of the record">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card press>
            <p className="pixel-label text-teal-deep">Roadmap</p>
            <p className="mt-2 text-base font-bold text-navy">The eight-day board, day by day</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              The target sequence, the honest pivot, where the project stands
              now, and what is next.
            </p>
            <Link href="/roadmap" className="btn-primary mt-4">
              Open the roadmap
            </Link>
          </Card>
          <Card press>
            <p className="pixel-label text-teal-deep">Changelog</p>
            <p className="mt-2 text-base font-bold text-navy">0.1.0 and 0.1.1, release by release</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Every group of changes, the release checklist, and the sync-loop
              activity strip.
            </p>
            <Link href="/changelog" className="btn-primary mt-4">
              Open the changelog
            </Link>
          </Card>
        </div>
      </Section>
    </div>
  );
}
