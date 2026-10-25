import { Card, Terminal } from '@/components/site/ui';
import type { Post } from '@/data/story';

/**
 * Renders the structured blocks of a story post. Server-safe: no hooks.
 */
export function PostBody({ post }: { post: Post }) {
  return (
    <div className="space-y-5">
      {post.blocks.map((block, i) => {
        switch (block.type) {
          case 'p':
            return (
              <p key={i} className="text-base leading-relaxed text-ink-dim">
                {block.text}
              </p>
            );
          case 'h2':
            return (
              <h2 key={i} className="pixel-label mt-4 text-teal-deep">
                {block.text}
              </h2>
            );
          case 'quote':
            return (
              <figure key={i} className="pixel-box--screen p-5">
                <blockquote className="text-base font-medium leading-relaxed text-screen-ink">
                  {block.text}
                </blockquote>
                {block.cite ? (
                  <figcaption className="pixel-label-sm mt-3 text-screen-dim">
                    {block.cite}
                  </figcaption>
                ) : null}
              </figure>
            );
          case 'term':
            return (
              <Terminal key={i} title={block.title}>
                <pre className="text-[13px] leading-relaxed text-screen-ink">
                  {block.lines.join('\n')}
                </pre>
              </Terminal>
            );
          case 'img':
            return (
              <Card key={i} press>
                <img
                  src={block.src}
                  alt={block.alt}
                  className="w-full rounded border-2 border-line-soft"
                />
                {block.caption ? (
                  <p className="mt-3 text-xs leading-relaxed text-ink-dim">{block.caption}</p>
                ) : null}
              </Card>
            );
          case 'list':
            return (
              <ul key={i} className="space-y-2">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-sm leading-relaxed text-ink-dim">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[1px] bg-teal"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
