import type { AuditResult, Finding, Location } from '../types.js';

/**
 * SARIF 2.1.0 `result.level` is an enum string: `none` | `note` | `warning` |
 * `error`. We start from the finding's severity and adjust down one step when
 * the finding's confidence is below CONFIRMED so unconfirmed findings are
 * reported as weaker signals. INFO/LOW never map above `note`.
 */
const SARIF_LEVELS: Record<string, Record<string, string>> = {
  INFO: { CONFIRMED: 'none', HIGH: 'none', MEDIUM: 'none', LOW: 'none' },
  LOW: { CONFIRMED: 'note', HIGH: 'note', MEDIUM: 'none', LOW: 'none' },
  MEDIUM: { CONFIRMED: 'warning', HIGH: 'warning', MEDIUM: 'note', LOW: 'note' },
  HIGH: { CONFIRMED: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'warning' },
  CRITICAL: { CONFIRMED: 'error', HIGH: 'error', MEDIUM: 'error', LOW: 'warning' },
};

/**
 * Serialize an audit result as a SARIF 2.1.0 document. Output is
 * deterministic: rules are ordered by id, results by ruleId then resultId,
 * and artifacts by uri, so identical audits produce identical bytes.
 */
export function toSarif(audit: AuditResult): string {
  const ruleIds = new Set<string>();
  for (const f of audit.findings) ruleIds.add(`${f.scanner}/${f.ruleId}`);
  const rules = [...ruleIds].sort().map((ruleId) => ({
    id: ruleId,
    name: ruleId,
    helpUri: `https://veylqorix.dev/rules/${encodeURIComponent(ruleId)}`,
    properties: { tags: ['security'] },
  }));

  const results = [...audit.findings]
    .sort((a, b) => {
      const byRule = `${a.scanner}/${a.ruleId}`.localeCompare(`${b.scanner}/${b.ruleId}`);
      return byRule !== 0 ? byRule : a.id.localeCompare(b.id);
    })
    .map((f, index) =>
      clean({
        ruleId: `${f.scanner}/${f.ruleId}`,
        ruleIndex: rules.findIndex((r) => r.id === `${f.scanner}/${f.ruleId}`),
        resultId: `${f.id}#${index}`,
        level: levelFor(f),
        message: { text: f.title },
        locations: locationsFor(f),
        properties: propertiesFor(f),
      }),
    );

  const doc = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      clean({
        tool: {
          driver: {
            name: 'Veylqorix',
            version: '0.1.0',
            informationUri: 'https://veylqorix.dev',
            rules,
          },
        },
        originalUriBaseIds: {
          veylqorixRoot: { uri: `${audit.root.replace(/[\\/]+$/, '')}/` },
        },
        artifacts: artifactsFor(audit),
        results,
      }),
    ],
  };

  return JSON.stringify(clean(doc), null, 2);
}

function levelFor(f: Finding): string {
  const levels = SARIF_LEVELS[f.severity] ?? SARIF_LEVELS.INFO;
  return levels?.[f.confidence] ?? 'note';
}

/** Location paths are root-relative and are resolved against the `veylqorixRoot` URI base. */
function locationsFor(f: Finding) {
  if (!f.location) return [];
  const location: Record<string, unknown> = {
    physicalLocation: {
      artifactLocation: { uri: posix(f.location), uriBaseId: 'veylqorixRoot' },
    },
  };
  if (f.location.line !== undefined || f.location.column !== undefined) {
    const region: Record<string, unknown> = {};
    if (f.location.line !== undefined) region.startLine = f.location.line;
    if (f.location.column !== undefined) region.startColumn = f.location.column;
    (location.physicalLocation as Record<string, unknown>).region = region;
  }
  return [clean(location)];
}

function propertiesFor(f: Finding) {
  return clean({
    'veylqorix/severity': f.severity,
    'veylqorix/confidence': f.confidence,
    'veylqorix/scanner': f.scanner,
    'veylqorix/secret': f.secret || undefined,
    'veylqorix/advisory': f.advisory,
    'veylqorix/dependency': f.dependency
      ? clean({
          name: f.dependency.name,
          installedVersion: f.dependency.installedVersion,
          declaredVersion: f.dependency.declaredVersion,
          fixedVersion: f.dependency.fixedVersion,
          packageManager: f.dependency.packageManager,
        })
      : undefined,
    'veylqorix/remediation': f.remediation,
  });
}

function artifactsFor(audit: AuditResult) {
  const byPath = new Map<string, number[]>();
  for (const f of audit.findings) {
    if (!f.location) continue;
    const uri = posix(f.location);
    const lines = byPath.get(uri) ?? [];
    if (f.location.line !== undefined && !lines.includes(f.location.line)) {
      lines.push(f.location.line);
    }
    byPath.set(uri, lines);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uri, lines]) =>
      clean({
        location: { uri, uriBaseId: 'veylqorixRoot' },
        veylqorix: { offsets: lines.sort((x, y) => x - y) },
      }),
    );
}

/** Windows separators are not valid in SARIF artifact URIs. */
function posix(location: Location): string {
  return location.file.replace(/\\/g, '/');
}

/** Drop undefined values so the emitted JSON contains no `null`-free holes. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) out[key] = clean(val);
    }
    return out;
  }
  return value;
}
