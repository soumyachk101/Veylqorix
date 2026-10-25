/**
 * License scanner (offline).
 *
 * Checks the project's own license declaration in package.json / pyproject.toml
 * and reports when no license is declared. It does not attempt to determine
 * the license of every transitive dependency without network access, because
 * that requires the advisory databases this platform treats as external
 * inputs. Instead it reports the limitation so that users know coverage is
 * PARTIAL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeFinding } from '../finding.js';
import type { Finding, ScannerResult } from '../types.js';

const DUAL_LICENSING_RISK = ['GPL', 'AGPL', 'MPL'] as const;

export interface LicenseScanOptions {
  root: string;
  mockFindings?: Finding[];
}

export async function scanLicenses(options: LicenseScanOptions): Promise<ScannerResult> {
  const { root } = options;
  const startedAt = Date.now();
  const notes: string[] = [];

  if (options.mockFindings !== undefined) {
    return {
      scanner: 'licenses',
      status: options.mockFindings.length > 0 ? 'FAIL' : 'PASS',
      findings: options.mockFindings,
      durationMs: Date.now() - startedAt,
      notes: ['Used deterministic mock findings (test mode)'],
    };
  }

  const findings: Finding[] = [];

  const pkgPath = path.join(root, 'package.json');
  const pyprojectPath = path.join(root, 'pyproject.toml');

  let licenseDeclared: string | undefined;
  let licenseSource: string | undefined;

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { license?: string; licenses?: string };
      licenseDeclared = pkg.license ?? pkg.licenses;
      licenseSource = 'package.json';
    } catch {
      /* invalid JSON is reported by TypeScript compilation, not here */
    }
  }
  if (!licenseDeclared && fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf8');
      const match = content.match(/license\s*=\s*["']([A-Za-z0-9.+-]+)["']/i);
      licenseDeclared = match?.[1];
      licenseSource = 'pyproject.toml';
    } catch {
      /* ignore */
    }
  }

  if (!licenseDeclared) {
    findings.push(
      makeFinding({
        scanner: 'licenses',
        ruleId: 'no-license-declared',
        title: 'No license is declared for this project',
        severity: 'LOW',
        confidence: 'HIGH',
        file: 'package.json',
        remediation: 'Declare a license in package.json (`"license"`) or pyproject.toml (`license = "..."`) so that users know the terms under which this code may be used.',
      }),
    );
    notes.push('No license was declared in any manifest.');
  } else {
    notes.push(`License '${licenseDeclared}' declared in ${licenseSource ?? 'manifest'}.`);
    const risky = DUAL_LICS
  }
  // Coverage note: we do not determine transitive dependency licenses offline.
  notes.push(
    'Transitive dependency licenses are not determined in this offline scan; a full license audit requires a package manager query or a dedicated license scanner.',
  );

  const status: ScannerResult['status'] = findings.length > 0 ? 'FAIL' : 'PASS';
  return {
    scanner: 'licenses',
    status,
    findings,
    durationMs: Date.now() - startedAt,
    notes,
    summary: { license: licenseDeclared ?? 'none', source: licenseSource ?? 'unknown' },
  };
}
