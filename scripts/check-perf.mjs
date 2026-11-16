#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const budgetFile = path.join(__dirname, 'perf-budget.json');
const distDir = path.join(rootDir, 'dist');
const indexHtmlFile = path.join(distDir, 'index.html');

if (!fs.existsSync(budgetFile)) {
  console.error(`[check:perf] Error: Baseline budget file not found: ${budgetFile}`);
  process.exit(1);
}

if (!fs.existsSync(indexHtmlFile)) {
  console.error(`[check:perf] Error: dist/index.html not found. Run 'npm run build' first.`);
  process.exit(1);
}

const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
const html = fs.readFileSync(indexHtmlFile, 'utf8');

// Match entry script tag
const scriptMatch = html.match(/<script[^>]+src=["']([^"']+)["']/i);
if (!scriptMatch) {
  console.error(`[check:perf] Error: Could not locate entry script in ${indexHtmlFile}`);
  process.exit(1);
}

const entryRelative = scriptMatch[1].replace(/^\//, '');
const entryFullPath = path.join(distDir, entryRelative);

if (!fs.existsSync(entryFullPath)) {
  console.error(`[check:perf] Error: Entry script file does not exist: ${entryFullPath}`);
  process.exit(1);
}

const entryStat = fs.statSync(entryFullPath);
const currentEntryBytes = entryStat.size;

// Match all modulepreload script tags
const preloadMatches = [...html.matchAll(/<link\s+[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
const preloadFiles = preloadMatches
  .map(m => m[1].replace(/^\//, ''))
  .filter(f => f.endsWith('.js'));

let totalInitialBytes = currentEntryBytes;
const chunkBreakdown = [
  { name: `Entry: ${path.basename(entryRelative)}`, size: currentEntryBytes }
];

for (const rel of preloadFiles) {
  const p = path.join(distDir, rel);
  if (fs.existsSync(p)) {
    const sz = fs.statSync(p).size;
    totalInitialBytes += sz;
    chunkBreakdown.push({ name: `Preload: ${path.basename(rel)}`, size: sz });
  } else {
    console.warn(`[check:perf] Warning: Preloaded file not found on disk: ${p}`);
  }
}

const maxGrowthPercent = budget.maxGrowthPercent ?? 10;
const allowedEntryMax = Math.round(budget.mainEntryChunkBytes * (1 + maxGrowthPercent / 100));
const allowedTotalMax = Math.round(budget.totalInitialJsBytes * (1 + maxGrowthPercent / 100));

const entryGrowth = ((currentEntryBytes - budget.mainEntryChunkBytes) / budget.mainEntryChunkBytes) * 100;
const totalGrowth = ((totalInitialBytes - budget.totalInitialJsBytes) / budget.totalInitialJsBytes) * 100;

console.log('\n=== EHI Bundle Performance Budget Check ===\n');
console.log('Initial JS Breakdown:');
for (const item of chunkBreakdown) {
  console.log(`  - ${item.name.padEnd(45)} ${(item.size / 1024).toFixed(2).padStart(8)} kB (${item.size} B)`);
}

console.log('\nBudget vs Current:');
console.log(`  Main Entry:       ${(currentEntryBytes / 1024).toFixed(2)} kB (${currentEntryBytes} B) | Baseline: ${(budget.mainEntryChunkBytes / 1024).toFixed(2)} kB | Max (+${maxGrowthPercent}%): ${(allowedEntryMax / 1024).toFixed(2)} kB | Diff: ${entryGrowth >= 0 ? '+' : ''}${entryGrowth.toFixed(2)}%`);
console.log(`  Total Initial JS: ${(totalInitialBytes / 1024).toFixed(2)} kB (${totalInitialBytes} B) | Baseline: ${(budget.totalInitialJsBytes / 1024).toFixed(2)} kB | Max (+${maxGrowthPercent}%): ${(allowedTotalMax / 1024).toFixed(2)} kB | Diff: ${totalGrowth >= 0 ? '+' : ''}${totalGrowth.toFixed(2)}%`);

let failed = false;
if (currentEntryBytes > allowedEntryMax) {
  console.error(`\n❌ FAIL: Main entry chunk grew by ${entryGrowth.toFixed(2)}%, exceeding budget threshold of +${maxGrowthPercent}%.`);
  failed = true;
}

if (totalInitialBytes > allowedTotalMax) {
  console.error(`\n❌ FAIL: Total initial JS grew by ${totalGrowth.toFixed(2)}%, exceeding budget threshold of +${maxGrowthPercent}%.`);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`\n✅ PASS: Bundle size is within +${maxGrowthPercent}% performance budget limits.\n`);
process.exit(0);
