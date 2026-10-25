/* Veylqorix web app: landing + dashboard, dependency-free.
 * Talks to the real Veylqorix API when reachable; otherwise renders a
 * clearly-labeled demo dataset (development only, never presented as live).
 */
(() => {
  const API_BASE = (() => {
    try { return new URL('http://localhost:4173').toString().replace(/\/$/, ''); } catch { return ''; }
  })();

  /* ---------------- icons (inline SVG, consistent set) ---------------- */
  const ICONS = {
    deps: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.5 8.5 12 12l7.5-3.5M4.5 15.5 12 19l7.5-3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    secret: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>',
    static: '<svg viewBox="0 0 24 24"><path d="M8 6 3.5 12 8 18M16 6l4.5 6L16 18" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gate: '<svg viewBox="0 0 24 24"><path d="M12 3v6m0 0-4 4m4-4 4 4M4 20h16" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    report: '<svg viewBox="0 0 24 24"><path d="M6 3h9l5 5v13H6zM14 3v6h6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 13h6M9 17h4" stroke-linecap="round"/></svg>',
    fix: '<svg viewBox="0 0 24 24"><path d="M5 13a7 7 0 0 1 14 0c0 4-3 6-3 6h-8s-3-2-3-6Z" stroke-linecap="round" stroke-linejoin="round"/><path d="m10.5 12 1.5 1.5 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cli: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2.5L7 15M13 15h4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mcp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 6.5 10 10M17 6.5 14 10M7 17.5 10 14M17 17.5 14 14" stroke-linecap="round"/></svg>',
    skill: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7l8 4 8-4-8-4ZM4 12l8 4 8-4M4 17l8 4 8-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ci: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M6 8.4v3A4 4 0 0 0 10 15.4h1M18 8.4v3a4 4 0 0 1-4 4h-1" stroke-linecap="round"/></svg>',
    hooks: '<svg viewBox="0 0 24 24"><path d="M9 4H5v16h4M15 20h4V4h-4M12 8v4m0 0-2.5 2.5M12 12l2.5 2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    api: '<svg viewBox="0 0 24 24"><path d="M4 14h4l2.5 4L15 6l2.5 8H20" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || '';
  });

  /* ---------------- DEMO DATA (development only, labeled) ---------------- */
  const demoFinding = (overrides) => ({
    id: 'DEMO-' + overrides.ruleId.toUpperCase().slice(0, 6),
    scanner: 'dependencies',
    ruleId: 'npm-audit',
    severity: 'HIGH',
    confidence: 'CONFIRMED',
    title: 'Vulnerable dependency',
    location: { file: 'package-lock.json' },
    dependency: { name: 'lodash', installedVersion: '4.17.20', fixedVersion: '4.17.21' },
    remediation: 'Upgrade lodash to 4.17.21+ and re-run the dependency scan.',
    advisory: 'GHSA-pxh6-xq82-qwg3',
    ...overrides,
  });
  const DEMO = {
    repo: { id: 'demo', name: 'demo-service (sample data)', path: '/sample' },
    gate: { result: 'FAIL', blockingReasons: ['HIGH finding demo lodash'], coverage: 'FULL' },
    exitCode: 1,
    detection: { ecosystem: 'node', packageManager: 'npm', gitRepository: true, languages: ['javascript'] },
    scanners: [
      { scanner: 'dependencies', status: 'FAIL', findingCount: 1, notes: ['npm audit reported 1 vulnerable package.'] },
      { scanner: 'secrets', status: 'PASS', findingCount: 0, notes: ['No known secret patterns matched.'] },
      { scanner: 'licenses', status: 'PASS', findingCount: 0, notes: [] },
    ],
    findings: [
      demoFinding({}),
      demoFinding({ id: 'DEMO-SECRET', scanner: 'secrets', ruleId: 'aws-access-key-id', severity: 'CRITICAL', confidence: 'HIGH', title: 'AWS access key detected in config.js', location: { file: 'config.js', line: 4 }, dependency: undefined, secret: true, evidence: { snippet: 'AKIA…CDEF (20 chars, redacted)' }, remediation: 'Remove the key, rotate it in AWS IAM, load from an environment variable.', advisory: 'https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html' }),
      demoFinding({ id: 'DEMO-MED', severity: 'MEDIUM', confidence: 'MEDIUM', title: 'Outdated vulnerable dependency minimist@1.2.5', dependency: { name: 'minimist', installedVersion: '1.2.5', fixedVersion: '1.2.8' }, location: { file: 'package-lock.json' }, advisory: 'GHSA-712h-v456-355h', remediation: 'Upgrade minimist to 1.2.8+.' }),
    ],
    history: [
      { id: 's3', status: 'DONE', gate: 'FAIL', findingCount: 3, createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
      { id: 's2', status: 'DONE', gate: 'PASS', findingCount: 0, createdAt: new Date(Date.now() - 9 * 86400000).toISOString() },
      { id: 's1', status: 'DONE', gate: 'PASS', findingCount: 0, createdAt: new Date(Date.now() - 16 * 86400000).toISOString() },
    ],
  };

  /* ---------------- API client (real data when reachable) ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { ok: res.ok, status: res.status, json };
  }

  /* ---------------- state ---------------- */
  const state = { repoId: null, running: false, usingDemo: false };
  const $ = (id) => document.getElementById(id);

  function gateClass(result) {
    return result === 'PASS' ? 'pass' : result === 'FAIL' ? 'fail' : result === 'INCOMPLETE' ? 'inc' : 'run';
  }
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- dashboard rendering ---------------- */
  function renderStats(scan) {
    const gate = scan.gate?.result ?? (scan.status === 'RUNNING' ? 'RUNNING' : 'INCOMPLETE');
    const findings = scan.findings ?? [];
    const sev = (s) => findings.filter((f) => f.severity === s).length;
    const counts = { CRITICAL: sev('CRITICAL'), HIGH: sev('HIGH'), MEDIUM: sev('MEDIUM'), LOW: sev('LOW') };
    $('statsRow').innerHTML = [
      stat('Gate', gate, gateClass(gate), gate === 'RUNNING' ? 'in progress' : `exit code ${scan.exitCode ?? '—'}`),
      stat('Findings', String(findings.length), '', counts.CRITICAL + ' critical · ' + counts.HIGH + ' high'),
      stat('Secrets', String(findings.filter((f) => f.secret).length), '', 'values redacted'),
      stat('Coverage', scan.coverage ?? '—', '', scan.detection?.ecosystem ? `ecosystem: ${scan.detection.ecosystem}` : ''),
    ].join('');
  }
  function stat(label, value, cls, sub) {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
  }

  function renderSevChart(findings) {
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    const counts = order.map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    $('sevChart').innerHTML = counts.map(({ s, n }) => {
      const fill = `var(--sev-${s.toLowerCase()})`;
      return `<div class="sev-row"><span class="sv">${s}</span><div class="sev-track"><div class="sev-fill sev-${s}" style="width:${(n / max) * 100}%;background:${fill}"></div></div><span class="n">${n}</span></div>`;
    }).join('');
  }

  function renderFindings(findings) {
    const list = $('findingsList');
    const st = $('findingsState');
    $('findingsCount').textContent = String(findings.length);
    renderSevChart(findings);
    if (!findings.length) {
      st.className = 'state empty';
      st.textContent = 'No findings from the scanners that ran. This is not a certification of absence — check coverage.';
      list.innerHTML = '';
      return;
    }
    st.className = 'state';
    st.textContent = '';
    list.innerHTML = findings.map((f, i) => `
      <li class="finding" role="button" tabindex="0" aria-expanded="false" data-i="${i}" aria-label="Finding: ${esc(f.title)}">
        <span class="sev-bar sev-${esc(f.severity)}" aria-hidden="true"></span>
        <span class="meta">
          <span class="ftitle">${esc(f.title)}</span>
          <span class="floc">${f.location ? `${esc(f.location.file)}${f.location.line ? ':' + f.location.line : ''}` : '—'}</span>
        </span>
        <span class="fsevs">${esc(f.severity)} · ${esc(f.confidence)}</span>
      </li>`).join('');
    list.querySelectorAll('.finding').forEach((el) => {
      const open = () => openDetail(findings[Number(el.dataset.i)]);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function openDetail(f) {
    const panel = $('detailPanel');
    panel.hidden = false;
    const dep = f.dependency ? `${esc(f.dependency.name)}@${esc(f.dependency.installedVersion ?? '?')}` : null;
    $('detailBody').innerHTML = `
      <div class="detail-head-meta">
        <span class="badge" style="background:color-mix(in srgb, var(--sev-${f.severity.toLowerCase()}) 18%, transparent);color:var(--sev-${f.severity.toLowerCase()})">${esc(f.severity)}</span>
        <span class="chip">${esc(f.confidence)}</span>
        ${f.secret ? '<span class="chip chip-inc">secret (redacted)</span>' : ''}
        <span class="floc" style="font-family:var(--mono);font-size:.8rem;color:var(--text-dim)">${esc(f.id)} · ${esc(f.scanner)}/${esc(f.ruleId)}</span>
      </div>
      ${f.location ? `<div class="detail-field"><div class="dlabel">Location</div><div class="dvalue"><code>${esc(f.location.file)}${f.location.line ? ':' + f.location.line : ''}</code></div></div>` : ''}
      ${dep ? `<div class="detail-field"><div class="dlabel">Dependency</div><div class="dvalue"><code>${dep}</code>${f.dependency?.fixedVersion ? ` <span class="muted">→ fixed in ${esc(f.dependency.fixedVersion)}</span>` : ''}</div></div>` : ''}
      ${f.evidence?.snippet ? `<div class="detail-field"><div class="dlabel">Evidence (redacted)</div><div class="dvalue"><code>${esc(f.evidence.snippet)}</code></div></div>` : ''}
      ${f.advisory ? `<div class="detail-field"><div class="dlabel">Advisory</div><div class="dvalue"><a href="${esc(f.advisory)}" target="_blank" rel="noopener">${esc(f.advisory)}</a></div></div>` : ''}
      ${f.remediation ? `<div class="detail-field detail-remed"><div class="dlabel">Remediation</div><div class="dvalue">${esc(f.remediation)}</div></div>` : ''}`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('detailClose').addEventListener('click', () => { $('detailPanel').hidden = true; });

  function renderHistory(history) {
    const list = $('historyList');
    const st = $('historyState');
    if (!history?.length) {
      st.className = 'state empty';
      st.textContent = 'No completed scans yet. Run a scan to build history.';
      list.innerHTML = '';
      return;
    }
    st.className = 'state';
    st.textContent = '';
    list.innerHTML = history.map((h) => `
      <li class="history-item">
        <span class="badge ${esc(h.gate ?? h.status)}">${esc(h.gate ?? 'INCOMPLETE')}</span>
        <span class="h-date">${new Date(h.createdAt).toLocaleString()}</span>
        <span class="muted" style="font-size:.8rem">${h.findingCount ?? 0} findings</span>
      </li>`).join('');
  }

  function showBanner(kind) {
    const b = $('dataSourceBanner');
    b.hidden = false;
    b.className = 'banner ' + kind;
    b.textContent = kind === 'demo'
      ? 'DEMO MODE — the API is not reachable. Everything on this page is a development sample, clearly labeled, not live scan data. Start the API (pnpm --filter @veylqorix/api start) to see real scans.'
      : 'LIVE — this dashboard is showing real scan data from the Veylqorix API.';
  }

  async function loadDashboard() {
    $('dashRepoName').textContent = 'Loading…';
    $('statsRow').innerHTML = '<div class="skeleton"></div>'.repeat(4);
    try {
      const repos = await api('/api/repositories');
      if (!repos.ok) throw new Error('api unreachable');
      state.usingDemo = false;
      showBanner('live');
      const list = repos.json.repositories ?? [];
      const sel = $('repoSelect');
      sel.innerHTML = list.length
        ? list.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')
        : '<option value="">No repositories registered</option>';
      const firstId = list[0]?.id;
      if (firstId) selectRepo(firstId);
      else {
        $('dashRepoName').textContent = 'No repositories registered yet';
        $('statsRow').innerHTML = '';
        $('findingsState').textContent = 'Register a repository on the API to start scanning.';
        renderHistory([]);
      }
    } catch {
      // Fall back to clearly-labeled demo data.
      state.usingDemo = true;
      showBanner('demo');
      $('dashRepoName').textContent = DEMO.repo.name;
      const sel = $('repoSelect');
      sel.innerHTML = '<option value="demo">demo-service (sample data)</option>';
      renderStats({ gate: DEMO.gate, exitCode: DEMO.exitCode, findings: DEMO.findings, coverage: DEMO.gate.coverage, detection: DEMO.detection, status: 'DONE' });
      renderFindings(DEMO.findings);
      renderHistory(DEMO.history);
    }
  }

  async function selectRepo(repoId) {
    state.repoId = repoId;
    await loadRepoData();
  }

  async function loadRepoData() {
    if (state.usingDemo) return;
    try {
      const [latest, history] = await Promise.all([
        api(`/api/repo/${state.repoId}/latest`),
        api(`/api/repo/${state.repoId}/history`),
      ]);
      if (!latest.ok) throw new Error('not found');
      const repo = latest.json.repository;
      $('dashRepoName').textContent = repo?.name ?? 'repository';
      const scan = latest.json.latest;
      if (!scan) {
        $('statsRow').innerHTML = '';
        $('findingsState').className = 'state empty';
        $('findingsState').textContent = 'No completed scan for this repository yet.';
        $('findingsList').innerHTML = '';
        $('findingsCount').textContent = '0';
        renderSevChart([]);
        renderHistory(history.json?.history ?? []);
        return;
      }
      renderStats({ ...scan, gate: scan.gate, coverage: scan.coverage, exitCode: scan.exitCode, findings: scan.findings, detection: scan.detection, status: scan.status });
      renderFindings(scan.findings ?? []);
      renderHistory(history.json?.history ?? []);
    } catch { /* keep previous state */ }
  }

  async function runScan() {
    const btn = $('runScan');
    if (state.running) return;
    state.running = true;
    btn.disabled = true;
    if (state.usingDemo) {
      // Demo mode: simulate a run clearly labeled as demo.
      await new Promise((r) => setTimeout(r, 1200));
      state.running = false;
      btn.disabled = false;
      $('findingsState').className = 'state empty';
      $('findingsState').textContent = 'Demo mode: starting a scan requires the API. Connect to the API for live runs.';
      return;
    }
    $('findingsState').className = 'state loading';
    $('findingsState').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:36px"></div>';
    try {
      const res = await api('/api/scan', { method: 'POST', body: { repoId: state.repoId } });
      if (!res.ok) throw new Error('scan failed to start');
      const scanId = res.json.scan.id;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await api(`/api/scan/${scanId}`);
        if (s.ok && s.json.status !== 'RUNNING') {
          await loadRepoData();
          state.running = false;
          btn.disabled = false;
          return;
        }
      }
      $('findingsState').className = 'state error';
      $('findingsState').textContent = 'Scan did not complete within 90s. Check the API logs.';
    } catch (e) {
      $('findingsState').className = 'state error';
      $('findingsState').textContent = 'Could not run scan: ' + e.message;
    }
    state.running = false;
    btn.disabled = false;
  }

  /* ---------------- routing ---------------- */
  function showView(name) {
    const isDash = name === 'dashboard';
    document.body.dataset.view = isDash ? 'dashboard' : 'landing';
    $('view-landing').hidden = isDash;
    $('view-dashboard').hidden = !isDash;
    document.querySelectorAll('.site-header').forEach((h) => (h.style.display = isDash ? 'none' : ''));
    document.querySelectorAll('.site-footer').forEach((f) => (f.style.display = isDash ? 'none' : ''));
    if (isDash) loadDashboard();
  }
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    showView(hash === 'dashboard' ? 'dashboard' : 'landing');
  }

  /* ---------------- wiring ---------------- */
  $('dashBack').addEventListener('click', () => { location.hash = '#/'; });
  $('runScan').addEventListener('click', runScan);
  $('repoSelect').addEventListener('change', (e) => selectRepo(e.target.value));
  window.addEventListener('hashchange', route);
  // Inject the feature icons that live in cards.
  route();
})();
