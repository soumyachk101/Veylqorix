#!/usr/bin/env node
/**
 * Render Veylqorix diagram SVGs to high-resolution PNGs.
 *
 * Usage (from the repo root):
 *   node Veylqorix_Diagrams/render-diagrams.mjs
 *
 * Rasterization uses `sharp` (libvips), discovered from the pnpm store when
 * it is only a transitive dependency. Each SVG is rasterized at 3x its
 * nominal pixel size (density = 96 * 3), so a 1200-unit SVG exports as
 * 3600 px wide. If no rasterizer is found, the SVGs are validated and the
 * exact PNG export commands are printed instead.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(dir, '..');

const SCALE = 3;

/**
 * Locate sharp. It may be a direct workspace dependency or a transitive
 * one in the pnpm virtual store (e.g. via next).
 */
async function loadSharp() {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const candidates = [path.join(repoRoot, 'node_modules', 'sharp')];
  const pnpmStore = path.join(repoRoot, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmStore)) {
    for (const entry of fs.readdirSync(pnpmStore)) {
      if (entry.startsWith('sharp@')) {
        const p = path.join(pnpmStore, entry, 'node_modules', 'sharp');
        if (fs.existsSync(path.join(p, 'package.json'))) candidates.push(p);
      }
    }
  }
  for (const c of candidates) {
    try {
      const mod = await import(require.resolve(c));
      // sharp's ESM wrapper may expose the function as .default or directly.
      const fn = mod.default ?? mod;
      if (typeof fn === 'function') return fn;
    } catch {
      /* keep looking */
    }
  }
  try {
    const mod = await import(require.resolve('sharp'));
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

const svgFiles = fs
  .readdirSync(dir)
  .filter((f) => /^0[1-5]_.*\.svg$/.test(f))
  .sort();

if (svgFiles.length === 0) {
  console.error('No 0[1-5]_*.svg source files found in', dir);
  process.exit(1);
}

// Validate SVG structure before rendering.
for (const f of svgFiles) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!/<svg[^>]*>/.test(raw) || !/<\/svg>/.test(raw)) {
    console.error(`[fail] ${f}: missing <svg> root element`);
    process.exit(1);
  }
  if ((raw.match(/<svg/g) || []).length !== (raw.match(/<\/svg>/g) || []).length) {
    console.error(`[fail] ${f}: unbalanced <svg> tags`);
    process.exit(1);
  }
}

const sharp = await loadSharp();

if (!sharp) {
  console.log('No SVG rasterizer (sharp) found. PNG export skipped.');
  console.log('The SVGs validated OK. Export PNGs by either:');
  console.log('');
  console.log('1. Adding sharp to the workspace and re-running:');
  console.log('   pnpm add -D sharp   (then: node Veylqorix_Diagrams/render-diagrams.mjs)');
  console.log('');
  console.log('2. Rendering each file at 3x with rsvg-convert:');
  for (const f of svgFiles) {
    const png = f.replace(/\.svg$/, '.png');
    console.log(`   rsvg-convert -z ${SCALE} -f png -o "${png}" "${f}"`);
  }
  console.log('');
  process.exit(0);
}

let failed = false;
for (const f of svgFiles) {
  const svgPath = path.join(dir, f);
  const pngPath = path.join(dir, f.replace(/\.svg$/, '.png'));
  const svg = fs.readFileSync(svgPath, 'utf8');
  // Use the SVG's own pixel width for the 3x scale target.
  const m = svg.match(/width="(\d+)"/);
  const width = m ? parseInt(m[1], 10) : 1200;
  try {
    const out = await sharp(Buffer.from(svg), { density: 96 * SCALE }).png().toBuffer();
    const resolved = await sharp(out).resize({ width: width * SCALE }).png().toBuffer();
    fs.writeFileSync(pngPath, resolved);
    const stats = fs.statSync(pngPath);
    const meta = await sharp(resolved).metadata();
    console.log(`[ok] ${f} -> ${path.basename(pngPath)} ${meta.width}x${meta.height} (${(stats.size / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(`[fail] ${f}: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
