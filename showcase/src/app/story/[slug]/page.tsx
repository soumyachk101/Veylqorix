import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { POSTS, POST_BY_SLUG } from '@/data/story';
import { PostLayout } from '@/components/story/post-layout';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = POST_BY_SLUG[slug];
  if (!post) return { title: 'Story — Veylqorix' };
  return { title: post.title, description: post.summary };
}

export default async function StoryPostPage({ params }: Props) {
  const { slug } = await params;
  if (!POST_BY_SLUG[slug]) notFound();
  return <PostLayout slug={slug} />;
}
