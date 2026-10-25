import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Docs } from '@/components/landing/docs';

export const metadata: Metadata = {
  title: 'Docs',
  description:
    'Veylqorix documentation: API reference, GitHub Actions gate, and troubleshooting.',
};

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Docs />
      </main>
      <Footer />
    </div>
  );
}
