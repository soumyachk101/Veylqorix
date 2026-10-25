import type { Metadata } from 'next';
import { Press_Start_2P, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { SmoothScroll } from '@/components/smooth-scroll';

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
    'Veylqorix is an AI-native code security platform: dependency auditing, secret detection, static analysis, and a policy-driven quality gate, wired into CLI, MCP, and GitHub Actions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
