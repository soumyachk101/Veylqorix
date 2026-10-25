import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import Dashboard from '@/components/dashboard/dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Live Veylqorix security dashboard: repositories, scan status, findings, gate verdicts, history, and policy.',
};

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Dashboard />
      </main>
      <Footer />
    </div>
  );
}
