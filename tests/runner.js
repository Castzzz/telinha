// tests/runner.js
// Autonomous, high-performance E2E test runner for Telinha.
// Supports 4-tier filtering, regex matching, rich spec reporter, and ephemeral fixtures.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { colors } from './helpers/test-utils.js';
import { startTestServer, stopTestServer } from './helpers/server-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global registry for suites and tests
export const registry = {
  tiers: new Map(), // tierId (1, 2, 3, 4) -> Array<{ suiteName, testName, fn, meta }>
  beforeAllHooks: [],
  afterAllHooks: []
};

let currentTier = 1;
let currentSuite = 'General';

export function setContext({ tier, suite }) {
  if (tier !== undefined) currentTier = Number(tier);
  if (suite !== undefined) currentSuite = suite;
}

export function beforeAll(fn) {
  registry.beforeAllHooks.push(fn);
}

export function afterAll(fn) {
  registry.afterAllHooks.push(fn);
}

export function describe(suiteName, fn, meta = {}) {
  const previousSuite = currentSuite;
  const previousTier = currentTier;
  currentSuite = suiteName;
  if (meta.tier) currentTier = Number(meta.tier);

  fn();

  currentSuite = previousSuite;
  currentTier = previousTier;
}

export function test(testName, fn, meta = {}) {
  const tier = meta.tier !== undefined ? Number(meta.tier) : currentTier;
  if (!registry.tiers.has(tier)) {
    registry.tiers.set(tier, []);
  }

  registry.tiers.get(tier).push({
    tier,
    suite: currentSuite,
    name: testName,
    fn,
    meta
  });
}

export const it = test;

// --------------------------------------------------------------------------
// Runner CLI Engine
// --------------------------------------------------------------------------

function parseArgs(args) {
  const options = {
    tiers: null,
    filter: null,
    reporter: 'spec',
    verbose: false,
    bail: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tier' && args[i + 1]) {
      options.tiers = args[i + 1].split(',').map((t) => Number(t.trim()));
      i++;
    } else if (arg.startsWith('--tier=')) {
      options.tiers = arg.split('=')[1].split(',').map((t) => Number(t.trim()));
    } else if (arg === '--filter' && args[i + 1]) {
      options.filter = new RegExp(args[i + 1], 'i');
      i++;
    } else if (arg.startsWith('--filter=')) {
      options.filter = new RegExp(arg.split('=')[1], 'i');
    } else if (arg === '--reporter' && args[i + 1]) {
      options.reporter = args[i + 1];
      i++;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--bail') {
      options.bail = true;
    }
  }

  return options;
}

async function run() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Register all 4 tier test files
  await import('./e2e/tier1-features.test.js');
  await import('./e2e/tier2-boundaries.test.js');
  await import('./e2e/tier3-combinations.test.js');
  await import('./e2e/tier4-scenarios.test.js');

  const banner = `
========================================================================
 📺 TELINHA AUTOMATED E2E TEST RUNNER — 4-TIER ARCHITECTURE
========================================================================`;
  if (options.reporter !== 'json') {
    console.log(colors.cyan + banner + colors.reset);
  }

  // Start ephemeral test server for network/HTTP/startup tests
  try {
    await startTestServer(18080);
  } catch (err) {
    console.warn(colors.yellow + `[Runner] Notice: Test server startup note: ${err.message}` + colors.reset);
  }

  // Execute global beforeAll hooks
  for (const hook of registry.beforeAllHooks) {
    await hook();
  }

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    tierBreakdown: {},
    failures: []
  };

  const startTime = Date.now();
  const sortedTiers = Array.from(registry.tiers.keys()).sort((a, b) => a - b);

  for (const tierNum of sortedTiers) {
    if (options.tiers && !options.tiers.includes(tierNum)) {
      continue;
    }

    const tierTests = registry.tiers.get(tierNum) || [];
    results.tierBreakdown[tierNum] = { total: 0, passed: 0, failed: 0 };

    if (options.reporter === 'spec') {
      console.log(`\n${colors.bold}${colors.magenta}=== TIER ${tierNum} ===${colors.reset}`);
    }

    let lastSuite = '';

    for (const t of tierTests) {
      if (options.filter && !options.filter.test(t.name) && !options.filter.test(t.suite)) {
        continue;
      }

      results.total++;
      results.tierBreakdown[tierNum].total++;

      if (options.reporter === 'spec' && t.suite !== lastSuite) {
        lastSuite = t.suite;
        console.log(`\n  ${colors.bold}${colors.blue}● ${t.suite}${colors.reset}`);
      }

      const tStart = Date.now();
      try {
        await t.fn();
        const duration = Date.now() - tStart;
        results.passed++;
        results.tierBreakdown[tierNum].passed++;

        if (options.reporter === 'spec') {
          console.log(`    ${colors.green}✓${colors.reset} ${t.name} ${colors.dim}(${duration}ms)${colors.reset}`);
        }
      } catch (err) {
        const duration = Date.now() - tStart;
        results.failed++;
        results.tierBreakdown[tierNum].failed++;
        results.failures.push({
          tier: tierNum,
          suite: t.suite,
          name: t.name,
          error: err,
          duration
        });

        if (options.reporter === 'spec') {
          console.log(`    ${colors.red}✗ ${t.name} (${duration}ms)${colors.reset}`);
          console.log(`      ${colors.red}Error: ${err.message}${colors.reset}`);
          if (options.verbose && err.stack) {
            console.log(`      ${colors.dim}${err.stack.split('\n').slice(1, 4).join('\n      ')}${colors.reset}`);
          }
        }

        if (options.bail) {
          break;
        }
      }
    }

    if (options.bail && results.failed > 0) {
      break;
    }
  }

  // Execute global afterAll hooks
  for (const hook of registry.afterAllHooks) {
    try {
      await hook();
    } catch {
      // ignore teardown errors
    }
  }

  await stopTestServer();

  results.durationMs = Date.now() - startTime;

  // Print Summary
  if (options.reporter === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\n========================================================================`);
    console.log(`${colors.bold}SUMMARY BY TIER:${colors.reset}`);
    for (const [tier, stats] of Object.entries(results.tierBreakdown)) {
      const statusColor = stats.failed === 0 ? colors.green : colors.red;
      console.log(`  Tier ${tier}: ${statusColor}${stats.passed}/${stats.total} passed${colors.reset}${stats.failed > 0 ? ` (${stats.failed} failed)` : ''}`);
    }

    console.log(`------------------------------------------------------------------------`);
    const finalColor = results.failed === 0 ? colors.bgGreen + colors.white : colors.bgRed + colors.white;
    console.log(` ${finalColor}${results.failed === 0 ? ' SUCCESS ' : ' FAILURE '}${colors.reset} ` +
      `Total: ${results.total} | Passed: ${results.passed} | Failed: ${results.failed} | Time: ${results.durationMs}ms`);
    console.log(`========================================================================\n`);

    if (results.failed > 0) {
      console.log(`${colors.bold}${colors.red}FAILED TESTS DETAILS:${colors.reset}`);
      for (const f of results.failures) {
        console.log(`\n  [Tier ${f.tier}] ${f.suite} -> ${f.name}`);
        console.log(`    ${colors.red}${f.error.message}${colors.reset}`);
        if (f.error.stack) {
          console.log(`    ${colors.dim}${f.error.stack.split('\n').slice(1, 3).join('\n    ')}${colors.reset}`);
        }
      }
      console.log('');
    }
  }

  process.exit(results.failed === 0 ? 0 : 1);
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}
