import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Hero } from '@/components/landing/hero';
import { Architecture } from '@/components/landing/architecture';
import { Capabilities } from '@/components/landing/capabilities';
import { Integrations } from '@/components/landing/integrations';
import { Docs } from '@/components/landing/docs';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Architecture />
        <Capabilities />
        <Integrations />
        <Docs />
      </main>
      <Footer />
    </div>
  );
}
