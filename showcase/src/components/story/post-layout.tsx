import Link from 'next/link';
import { POSTS } from '@/data/story';
import { PostBody } from '@/components/story/post-body';

/**
 * Prose column for a single story post: meta row, title, body, and
 * prev/next navigation in posting order.
 */
export function PostLayout({ slug }: { slug: string }) {
  const index = POSTS.findIndex((p) => p.slug === slug);
  if (index === -1) return null;
  const post = POSTS[index];
  const prev = index > 0 ? POSTS[index - 1] : undefined;
  const next = index < POSTS.length - 1 ? POSTS[index + 1] : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/story"
        className="pixel-label-sm inline-block rounded px-2 py-1 text-teal-deep hover:bg-surface-2"
      >
        ← All posts
      </Link>

      <div className="pixel-box mt-6 p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-3 border-b-4 border-line-soft pb-5">
          <span className="pixel-label-sm rounded bg-surface-2 px-2 py-1 text-navy">{post.tag}</span>
          <span className="pixel-label-sm text-ink-dim">{post.date}</span>
          <span className="pixel-label-sm text-ink-dim">
            {String(index + 1).padStart(2, '0')} / {String(POSTS.length).padStart(2, '0')}
          </span>
        </div>

        <h1 className="mt-6 text-3xl font-extrabold leading-tight tracking-tight text-navy sm:text-4xl">
          {post.title}
        </h1>

        <div className="mt-6">
          <PostBody post={post} />
        </div>
      </div>

      <nav aria-label="Post navigation" className="mt-8 grid gap-4 sm:grid-cols-2">
        {prev ? (
          <Link href={`/story/${prev.slug}`} className="pixel-box press block p-4">
            <p className="pixel-label-sm text-teal-deep">← Previous</p>
            <p className="mt-1 text-sm font-bold text-navy">{prev.title}</p>
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        {next ? (
          <Link href={`/story/${next.slug}`} className="pixel-box press block p-4 text-right">
            <p className="pixel-label-sm text-teal-deep">Next →</p>
            <p className="mt-1 text-sm font-bold text-navy">{next.title}</p>
          </Link>
        ) : (
          <Link href="/changelog" className="pixel-box press block p-4 text-right">
            <p className="pixel-label-sm text-teal-deep">What shipped next</p>
            <p className="mt-1 text-sm font-bold text-navy">The changelog →</p>
          </Link>
        )}
      </nav>
    </div>
  );
}
