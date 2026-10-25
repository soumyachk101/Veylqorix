'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  Download,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldQuestion,
} from 'lucide-react';
import {
  addRepository,
  getHistory,
  getLatest,
  getScan,
  getHealth,
  listRepositories,
  startScan,
} from '../../lib/api';
import type { Finding, Repository, ScanDetail } from '../../lib/types';
import { SEVERITY_RANK, SEVERITIES } from '../../lib/types';
import { countBySeverity, locLabel } from '../../lib/findings';
import {
  DemoBanner,
  EmptyState,
  ErrorState,
  GateChip,
  LiveBanner,
  Panel,
  PixelBlocks,
  SEVERITY_COLOR,
  SeverityChip,
  Skeleton,
  StatusChip,
} from './parts';

type LoadState = 'idle' | 'loading' | 'ok' | 'error';

interface ApiHealth {
  state: LoadState;
  error?: string;
}

/** One row of the scan history table (GET /api/repo/:id/history shape). */
interface HistoryRow {
  id: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  createdAt: string;
}

const POLL_MS = 2500;

/* ------------------------------------------------------------------ */
/* Demo data — clearly labeled SAMPLE, never presented as live data    */
/* ------------------------------------------------------------------ */

const DEMO_REPO: Repository = {
  id: 'repo-demo',
  path: '/demo/sample-service',
  name: 'sample-service (sample data)',
  registeredAt: new Date(0).toISOString(),
};

const DEMO_FINDINGS: Finding[] = [
  {
    id: 'DEP-NPM-1042-91ab',
    title: 'minimist < 1.2.8 vulnerable to prototype pollution',
    scanner: 'dependencies',
    ruleId: 'npm-audit',
    severity: 'MEDIUM',
    confidence: 'CONFIRMED',
    location: { file: 'package-lock.json', line: 2210 },
    dependency: {
      name: 'minimist',
      installedVersion: '1.2.5',
      declaredVersion: '^1.2.0',
      fixedVersion: '1.2.8',
      packageManager: 'npm',
    },
    evidence: { details: { advisory: 'GHSA-xcv8-vvgj-4gp5' } },
    remediation: 'Upgrade minimist to >= 1.2.8.',
    advisory: 'GHSA-xcv8-vvgj-4gp5',
  },
  {
    id: 'SEC-ENV-2201-77cc',
    title: 'AWS access key id detected in .env',
    scanner: 'secrets',
    ruleId: 'aws-access-key-id',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    location: { file: '.env', line: 3 },
    evidence: { snippet: 'AWS_ACCESS_KEY_ID=AKIA************ [redacted]' },
    remediation: 'Rotate the exposed key, move it to a secret manager, and git-ignore .env.',
    secret: true,
  },
  {
    id: 'SAST-TS-3302-a1d4',
    title: 'child_process.exec uses a shell with user-controlled input',
    scanner: 'quality',
    ruleId: 'no-shell-injection',
    severity: 'HIGH',
    confidence: 'MEDIUM',
    location: { file: 'src/build.ts', line: 47 },
    evidence: { snippet: 'exec(`npm run ${cmd} -- ${args}`)' },
    remediation: 'Use execFile with an argument array; do not pass user input through a shell.',
  },
  {
    id: 'DEP-NPM-4410-b2e5',
    title: 'node-fetch < 3.1.1 vulnerable to Denial of Service',
    scanner: 'dependencies',
    ruleId: 'npm-audit',
    severity: 'LOW',
    confidence: 'CONFIRMED',
    location: { file: 'package-lock.json', line: 804 },
    dependency: { name: 'node-fetch', installedVersion: '3.0.0', fixedVersion: '3.1.1', packageManager: 'npm' },
    remediation: 'Upgrade node-fetch to >= 3.1.1.',
    advisory: 'GHSA-9frj-qwqh-mr3v',
  },
];

const DEMO_HISTORY: HistoryRow[] = [
  {
    id: 'scan-demo-0004',
    status: 'DONE',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'scan-demo-0003',
    status: 'DONE',
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'scan-demo-0002',
    status: 'ERROR',
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  },
];

const DEMO_DETAIL: ScanDetail = {
  id: 'scan-demo-0004',
  repoId: DEMO_REPO.id,
  status: 'DONE',
  gate: {
    result: 'FAIL',
    blockingReasons: ['SEC-ENV-2201-77cc', 'SAST-TS-3302-a1d4'],
    reportedFindings: [],
    incompleteReasons: [],
    coverage: 'FULL',
    appliedExceptions: [],
  },
  coverage: 'FULL',
  exitCode: 1,
  findings: DEMO_FINDINGS,
  scanners: [
    { scanner: 'dependencies', status: 'PASS', notes: ['npm audit (lockfile)'] },
    { scanner: 'secrets', status: 'FAIL', notes: ['1 exposed secret'] },
    { scanner: 'quality', status: 'PASS', notes: [] },
  ],
  detection: {
    ecosystem: 'node',
    packageManager: 'npm',
    manifests: ['package.json'],
    lockfiles: ['package-lock.json'],
    gitRepository: true,
    languages: ['typescript'],
    reasons: ['package.json detected'],
  },
};

function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (a.location?.file ?? '').localeCompare(b.location?.file ?? '')
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState<ApiHealth>({ state: 'idle' });
  const [repos, setRepos] = useState<Repository[]>([]);
  const [reposState, setReposState] = useState<LoadState>('idle');
  const [reposError, setReposError] = useState('');

  const [selected, setSelected] = useState<Repository | null>(null);
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('idle');
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [demoActive, setDemoActive] = useState(false);

  const [regPath, setRegPath] = useState('');
  const [regName, setRegName] = useState('');
  const [formBusy, setFormBusy] = useState<null | 'register' | 'scan'>(null);
  const [formError, setFormError] = useState('');

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const checkHealth = useCallback(async () => {
    try {
      await getHealth();
      setHealth({ state: 'ok' });
    } catch (e) {
      setHealth({ state: 'error', error: e instanceof Error ? e.message : 'unreachable' });
    }
  }, []);

  const loadRepos = useCallback(async () => {
    setReposState('loading');
    setDemoActive(false);
    try {
      const list = await listRepositories();
      setRepos(list);
      setReposState('ok');
    } catch (e) {
      setReposError(e instanceof Error ? e.message : 'failed to list repositories');
      setReposState('error');
    }
  }, []);

  const startPolling = useCallback((scanId: string, repo: Repository) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const d = await getScan(scanId);
        if (d.status === 'RUNNING') return;
        stopPolling();
        setDetail(d);
        setDetailState('ok');
        const hist = await getHistory(repo.id);
        setHistory(hist.history);
      } catch {
        /* transient error — keep polling */
      }
    }, POLL_MS);
  }, []);

  const loadRepo = useCallback(
    async (repo: Repository) => {
      setSelected(repo);
      setDetail(null);
      setDetailState('loading');
      setHistory(null);
      setDemoActive(false);
      try {
        const [latest, hist] = await Promise.all([getLatest(repo.id), getHistory(repo.id)]);
        setHistory(hist.history);
        if (latest.latest) {
          const d = await getScan(latest.latest.id);
          setDetail(d);
          if (d.status === 'RUNNING') startPolling(d.id, repo);
        }
        setDetailState('ok');
      } catch {
        setDetailState('error');
      }
    },
    [startPolling]
  );

  useEffect(() => {
    void checkHealth();
    void loadRepos();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select the first repository when the list arrives.
  useEffect(() => {
    if (reposState === 'ok' && !selected && repos.length > 0) {
      void loadRepo(repos[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reposState, repos.length, selected]);

  const apiDown = health.state === 'error';

  const registerRepo = async () => {
    setFormError('');
    setFormBusy('register');
    try {
      const repo = await addRepository(regPath.trim(), regName.trim() || undefined);
      setRegPath('');
      setRegName('');
      await loadRepos();
      await loadRepo(repo);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'registration failed');
    } finally {
      setFormBusy(null);
    }
  };

  const runScan = async () => {
    setFormError('');
    setFormBusy('scan');
    try {
      let repo: Repository | null = selected;
      if (regPath.trim()) {
        repo = await addRepository(regPath.trim(), regName.trim() || undefined);
        setRegPath('');
        setRegName('');
      }
      if (!repo) {
        setFormError('Register a repository (or type a path) before scanning.');
        return;
      }
      const scan = await startScan(repo.id);
      await loadRepos();
      await loadRepo(repo);
      startPolling(scan.id, repo);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'scan failed to start');
    } finally {
      setFormBusy(null);
    }
  };

  const refreshAll = async () => {
    stopPolling();
    setDetailState('idle');
    await Promise.all([checkHealth(), loadRepos()]);
    if (selected) await loadRepo(selected);
  };

  const seedDemo = () => {
    stopPolling();
    setSelected(DEMO_REPO);
    setDetail(DEMO_DETAIL);
    setHistory(DEMO_HISTORY);
    setDetailState('ok');
    setDemoActive(true);
  };

  const findings =
    detail?.status === 'DONE' ? sortFindings(detail.findings ?? []) : [];
  const counts = useMemo(() => countBySeverity(findings), [findings]);
  const maxCount = Math.max(1, ...SEVERITIES.map((s) => counts[s] ?? 0));

  const showDemo = demoActive;
  const showLive = !showDemo && reposState === 'ok' && repos.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="pixel-label-sm text-ink-dim">Veylqorix / dashboard</p>
          <h1 className="text-pixel-shadow mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Scan Control
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <HealthPill health={health} onRetry={() => void checkHealth()} />
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="pixel-box press flex items-center gap-2 rounded px-3 py-2 text-sm font-bold text-ink"
            disabled={reposState === 'loading'}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Banners */}
      <div className="mt-6 space-y-3">
        {showDemo && (
          <DemoBanner>
            Showing seeded sample data — not live scan results. Clear it and refresh to see real
            data from the API.
          </DemoBanner>
        )}
        {!showDemo && apiDown ? (
          <DemoBanner>
            The Veylqorix API is unreachable ({health.error}). Start it with{' '}
            <code className="font-mono text-[13px]">pnpm --filter @veylqorix/api start</code>{' '}
            and refresh — or seed sample data to explore the UI.
          </DemoBanner>
        ) : null}
        {!showDemo && health.state === 'ok' && (
          <LiveBanner>
            Connected to the Veylqorix API — repositories, scans, and findings below are real data.
          </LiveBanner>
        )}
      </div>

      {/* Register / scan form */}
      {!showDemo && (
        <div className="mt-6">
          <RegisterForm
            path={regPath}
            name={regName}
            onPathChange={setRegPath}
            onNameChange={setRegName}
            onRegister={() => void registerRepo()}
            onScan={() => void runScan()}
            busy={formBusy}
            error={formError}
            disabled={apiDown}
            compact={reposState === 'ok' && repos.length > 0}
          />
        </div>
      )}

      {/* Main grid */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {showDemo ? (
            <>
              <SampleBadge label="sample data" />
              <LatestScan
                detail={detail}
                repo={selected}
                onScan={seedDemo}
                onDownload={() => {}}
                downloadsDisabled
              />
              <FindingsPanel findings={findings} />
              {history && history.length > 0 && <HistoryPanel history={history} />}
            </>
          ) : reposState === 'loading' || (repos.length > 0 && detailState === 'loading') ? (
            <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading scan data">
              <Skeleton lines={3} />
              <Skeleton lines={3} />
              <Skeleton lines={4} tall />
            </div>
          ) : reposState === 'error' || apiDown ? (
            <ErrorState
              title={apiDown ? 'API offline' : 'API error'}
              detail={
                apiDown
                  ? `The API is unreachable (${health.error}). Start it and refresh, or seed sample data to explore the dashboard UI.`
                  : reposError
              }
              onRetry={() => void refreshAll()}
            />
          ) : repos.length === 0 ? (
            <EmptyState
              title="No repositories yet — register one"
              detail="Register a repository path above, then hit Scan. Results appear here the moment the gate finishes."
            />
          ) : (
            <>
              {detailState === 'error' ? (
                <ErrorState
                  title="Could not load scan detail"
                  onRetry={() => selected && void loadRepo(selected)}
                />
              ) : (
                <LatestScan
                  detail={detail}
                  repo={selected}
                  onScan={() => void runScan()}
                  onDownload={(fmt) => detail && downloadReport(detail.id, fmt)}
                  downloadsDisabled={detail?.status !== 'DONE'}
                />
              )}
              {detail?.status === 'DONE' && <FindingsPanel findings={findings} />}
              {detail?.status === 'ERROR' && (
                <Panel label="Last scan errored">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink-dim">
                    <StatusChip status="ERROR" />
                    {detail.error ? <span>{detail.error}</span> : <span>The scan did not complete.</span>}
                  </p>
                </Panel>
              )}
              {history && history.length > 0 && <HistoryPanel history={history} />}
            </>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <SeverityPanel counts={counts} maxCount={maxCount} total={findings.length} hasData={showLive || showDemo} />
          <PolicyPanel />
          {showDemo && (
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="pixel-box press w-full rounded px-4 py-2 text-sm font-bold text-ink"
            >
              Clear sample data & refresh
            </button>
          )}
          {(!apiDown && repos.length === 0 && reposState === 'ok') || apiDown ? (
            <Panel label="Sample data (clearly not live)">
              <p className="text-sm text-ink-dim">
                Want to see the dashboard populated without running the API? Seed sample findings —
                every view will be badged{' '}
                <span className="pixel-label-sm text-gold-faint">SAMPLE</span>.
              </p>
              <button
                type="button"
                onClick={seedDemo}
                className="pixel-box press mt-4 flex items-center gap-2 rounded bg-surface px-4 py-2 text-sm font-bold text-ink"
              >
                <ShieldQuestion className="h-4 w-4 text-gold-faint" aria-hidden="true" />
                Seed demo data
              </button>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SampleBadge({ label }: { label: string }) {
  return (
    <p className="pixel-label-sm text-gold-faint" role="status">
      {label} — everything below is seeded sample data, not a live scan
    </p>
  );
}

function downloadReport(scanId: string, format: 'json' | 'sarif' | 'markdown') {
  void fetch(`/api/scan/${encodeURIComponent(scanId)}/report?format=${format}`)
    .then((r) => {
      if (!r.ok) throw new Error(`report request failed (${r.status})`);
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `veylqorix-${scanId.slice(-10)}-report.${format === 'markdown' ? 'md' : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch(() => {
      /* report unavailable (scan incomplete or API down) */
    });
}

function HealthPill({ health, onRetry }: { health: ApiHealth; onRetry: () => void }) {
  const live = health.state === 'ok';
  return (
    <span
      className={`flex items-center gap-2 rounded border-4 bg-surface px-3 py-1.5 ${
        live ? 'border-teal-deep' : 'border-coral'
      }`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-teal-deep' : health.state === 'idle' ? 'bg-gold' : 'bg-coral blink'}`}
        aria-hidden="true"
      />
      <span className="pixel-label-sm text-ink">
        {live ? 'API online' : health.state === 'idle' ? 'API checking' : 'API offline'}
      </span>
      {!live && health.state !== 'idle' && (
        <button type="button" onClick={onRetry} className="text-xs font-bold text-ink-dim underline">
          retry
        </button>
      )}
    </span>
  );
}

function RegisterForm({
  path,
  name,
  onPathChange,
  onNameChange,
  onRegister,
  onScan,
  busy,
  error,
  disabled,
  compact,
}: {
  path: string;
  name: string;
  onPathChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onRegister: () => void;
  onScan: () => void;
  busy: null | 'register' | 'scan';
  error: string;
  disabled: boolean;
  compact: boolean;
}) {
  return (
    <form
      className="pixel-box rounded p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onRegister();
      }}
    >
      <p className="pixel-label-sm text-ink-dim">{compact ? 'Register a repository' : 'Register & scan'}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1.2fr_auto_auto]">
        <input
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="/absolute/path/to/repo"
          aria-label="Repository path"
          disabled={disabled}
          className="rounded border-4 border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-dim/60 disabled:opacity-50"
        />
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="name (optional)"
          aria-label="Repository name (optional)"
          disabled={disabled}
          className="rounded border-4 border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-dim/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || busy !== null || !path.trim()}
          className="pixel-box press flex items-center justify-center gap-1.5 rounded bg-surface px-3 py-2 text-sm font-bold text-ink disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Register
        </button>
        <button
          type="button"
          onClick={onScan}
          disabled={disabled || busy !== null}
          className="pixel-box press flex items-center justify-center gap-1.5 rounded bg-navy px-3 py-2 text-sm font-bold text-screen-ink disabled:opacity-50"
          title={selectedScanTargetHint(path, disabled)}
        >
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          Scan
        </button>
      </div>
      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-coral-faint" role="alert">
          <CircleAlert className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      )}
      {busy === 'scan' && (
        <p className="mt-3 text-sm text-ink-dim" role="status">
          Scan started — polling for results…
        </p>
      )}
    </form>
  );
}

function selectedScanTargetHint(path: string, disabled: boolean): string {
  if (disabled) return 'API is offline — start it to enable scanning';
  return path.trim()
    ? 'Register the typed path, then scan it'
    : 'Scan the selected repository';
}

function LatestScan({
  detail,
  repo,
  onScan,
  onDownload,
  downloadsDisabled,
}: {
  detail: ScanDetail | null;
  repo: Repository | null;
  onScan: () => void;
  onDownload: (fmt: 'json' | 'sarif' | 'markdown') => void;
  downloadsDisabled?: boolean;
}) {
  if (!detail) {
    return (
      <EmptyState
        title="No scans yet"
        detail={`No completed scan for ${repo?.name ?? 'this repository'} yet. Run the first one.`}
      >
        <button
          type="button"
          onClick={onScan}
          className="pixel-box press flex items-center gap-2 rounded bg-navy px-4 py-2 text-sm font-bold text-screen-ink"
        >
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          Scan this repository
        </button>
      </EmptyState>
    );
  }

  const incomplete =
    detail.gate?.result === 'INCOMPLETE' ||
    (detail.coverage != null && detail.coverage !== 'FULL');

  return (
    <Panel
      label={`Latest scan — ${repo?.name ?? detail.repoId}`}
      right={
        detail.status === 'RUNNING' ? null : (
          <button
            type="button"
            onClick={onScan}
            className="pixel-box press flex items-center gap-1.5 rounded bg-navy px-3 py-1.5 text-xs font-bold text-screen-ink"
          >
            <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
            Scan again
          </button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={detail.status} />
        {detail.gate && <GateChip result={detail.gate.result} />}
        {typeof detail.exitCode === 'number' && (
          <span className="font-mono text-sm text-ink-dim">exit {detail.exitCode}</span>
        )}
      </div>

      {incomplete && detail.gate && (
        <div className="mt-4 rounded border-4 border-gold bg-surface-2 p-3">
          <p className="pixel-label-sm text-gold-faint">Partial / incomplete coverage</p>
          <p className="mt-1 text-sm text-ink-dim">
            Coverage: <strong>{detail.coverage ?? 'unknown'}</strong>. The gate does not treat
            incomplete scans as clean.
          </p>
          {detail.gate.incompleteReasons.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm text-ink-dim">
              {detail.gate.incompleteReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {detail.scanners && detail.scanners.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {detail.scanners.map((s) => (
            <div key={s.scanner} className="rounded border-2 border-line-soft bg-surface-2 p-3">
              <p className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-bold text-ink">{s.scanner}</span>
                <StatusChip status={s.status} />
              </p>
              {s.notes && s.notes.length > 0 ? (
                <p className="mt-1 truncate text-xs text-ink-dim" title={s.notes.join(' · ')}>
                  {s.notes.join(' · ')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {detail.status === 'DONE' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t-2 border-line-soft pt-4">
          <span className="pixel-label-sm text-ink-dim">Reports</span>
          {(['json', 'sarif', 'markdown'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => onDownload(fmt)}
              disabled={downloadsDisabled}
              className="pixel-box press flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function FindingsPanel({ findings }: { findings: Finding[] }) {
  return (
    <Panel
      label={`Findings (${findings.length})`}
      right={<span className="pixel-label-sm text-ink-dim">sorted by severity</span>}
    >
      {findings.length === 0 ? (
        <p className="text-sm text-ink-dim">
          No findings on the latest completed scan. Clean bill of health.
        </p>
      ) : (
        <ul className="divide-y-2 divide-line-soft">
          {findings.map((f) => (
            <li key={f.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityChip severity={f.severity} />
                <span className="text-sm font-bold text-ink">{f.title}</span>
                {f.secret && (
                  <span className="pixel-label-sm rounded border-2 border-coral px-1 text-coral-faint">
                    SECRET
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-ink-dim">{f.id}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-dim">
                <span title="scanner / rule">{f.scanner}/{f.ruleId}</span>
                {f.location && <span>{locLabel(f)}</span>}
                {f.dependency && (
                  <span>
                    {f.dependency.name}
                    {f.dependency.installedVersion ? `@${f.dependency.installedVersion}` : ''}
                    {f.dependency.fixedVersion ? ` → ${f.dependency.fixedVersion}` : ''}
                  </span>
                )}
              </div>
              {f.evidence?.snippet && (
                <pre className="mt-2 max-w-2xl overflow-x-auto rounded border-4 border-line bg-screen p-3 font-mono text-xs text-screen-ink">
                  {f.evidence.snippet}
                </pre>
              )}
              {f.remediation && (
                <p className="mt-2 text-sm text-ink-dim">
                  <span className="font-bold text-ink">Remediation:</span> {f.remediation}
                </p>
              )}
              {f.advisory && (
                <p className="mt-1 font-mono text-xs text-ink-dim">advisory: {f.advisory}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HistoryPanel({ history }: { history: HistoryRow[] }) {
  return (
    <Panel label="Scan history">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="pixel-label-sm text-left text-ink-dim">
              <th scope="col" className="pb-2 pr-3">
                Scan
              </th>
              <th scope="col" className="pb-2 pr-3">
                Status
              </th>
              <th scope="col" className="pb-2">
                Started
              </th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t-2 border-line-soft">
                <td className="py-2 pr-3 font-mono text-xs text-ink-dim">{h.id.slice(0, 24)}…</td>
                <td className="py-2 pr-3">
                  <StatusChip status={h.status} />
                </td>
                <td className="py-2 font-mono text-xs text-ink-dim">
                  {new Date(h.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SeverityPanel({
  counts,
  maxCount,
  total,
  hasData,
}: {
  counts: Record<string, number>;
  maxCount: number;
  total: number;
  hasData: boolean;
}) {
  return (
    <Panel label="Severity breakdown">
      <div className="space-y-3">
        {SEVERITIES.map((s) => (
          <div key={s} className="grid grid-cols-[72px_1fr_28px] items-center gap-3">
            <span className="pixel-label-sm" style={{ color: SEVERITY_COLOR[s] }}>
              {s}
            </span>
            <PixelBlocks
              value={counts[s] ?? 0}
              max={maxCount}
              color={SEVERITY_COLOR[s]}
              count={counts[s] ?? 0}
            />
            <span className="text-right font-mono text-sm font-bold text-ink">{counts[s] ?? 0}</span>
          </div>
        ))}
        <p className="border-t-2 border-line-soft pt-3 text-xs text-ink-dim">
          {hasData
            ? `${total} total finding${total === 1 ? '' : 's'} on the latest scan.`
            : 'Counts appear once a scan completes.'}
        </p>
      </div>
    </Panel>
  );
}

/**
 * Policy configuration view. Mirrors the workspace `veylqorix-policy.json`
 * (the engine's DEFAULT_POLICY), which is what the API evaluates scans against.
 */
function PolicyPanel() {
  return (
    <Panel label="Policy configuration (engine default)">
      <dl className="space-y-2 text-sm">
        <PolicyRow k="Block on severity" v="CRITICAL, HIGH" />
        <PolicyRow k="Report on severity" v="MEDIUM, LOW" />
        <PolicyRow k="Block on secrets" v="yes" />
        <PolicyRow k="Block on test failure" v="yes" />
        <PolicyRow k="Block on scanner error" v="yes" />
        <PolicyRow k="Block on skipped check" v="yes" />
        <PolicyRow k="Max exceptions" v="5" />
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-ink-dim">
        Mirrors <code className="font-mono">veylqorix-policy.json</code> in the monorepo root.
        The gate refuses to treat incomplete coverage as clean — a scanner error or skip
        downgrades the verdict to INCOMPLETE (exit 2), never to PASS.
      </p>
    </Panel>
  );
}

function PolicyRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border-2 border-line-soft bg-surface-2 px-3 py-2">
      <dt className="text-xs font-semibold text-ink-dim">{k}</dt>
      <dd className="font-mono text-xs font-bold text-ink">{v}</dd>
    </div>
  );
}
