import type { Metadata } from 'next';
import { Press_Start_2P, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/site/header';
import { Footer } from '@/components/site/footer';

const pixel = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

const sans = Hanken_Grotesk({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Veylqorix — No Unsafe Code Gets Through',
    template: '%s — Veylqorix',
  },
  description:
    'Veylqorix is a universal code-security and quality platform that verifies AI-generated and human-written code before it ships. The build story, changelog, and a full tour of the platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
