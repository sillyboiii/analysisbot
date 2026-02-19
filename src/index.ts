/**
 * Strong Coin Finder — Main Entry Point
 *
 * Runs on a cron schedule (default: every hour) and outputs a ranked list
 * of coins worth attention based on relative strength, flow, and structure.
 * Also serves a live web dashboard on PORT (default: 3000).
 *
 * Usage:
 *   npm run dev          # run once immediately + start scheduler + web server
 *   npm run build        # compile TypeScript
 *   npm start            # run compiled build
 *
 * Configuration: see src/config.ts
 * Environment:   copy .env.example → .env and set variables
 */

import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import { getMarketContext } from './engines/marketContext';
import { scoreAndRankCoins, scoreAndRankShorts } from './engines/scorer';
import { printOutput, printSummaryLine } from './output/formatter';
import { BotOutput } from './types';
import { RUN_CRON } from './config';
import { createWebServer } from './server/webserver';
import { setStatus, setLatest, getSnapshot } from './server/store';
import { sendTelegramUpdate } from './output/telegram';

dotenv.config();

// ─── Web Server ───────────────────────────────────────────────────────────────

const { io, start: startWebServer } = createWebServer();

// ─── Core Run Function ────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const timestamp = new Date();
  console.log(`\n[${timestamp.toISOString()}] Starting analysis run...`);

  setStatus('scanning');
  io.emit('scan:start');

  let output: BotOutput;

  try {
    // Step 1: Classify BTC regime (global gate)
    console.log('  [1/4] Fetching BTC market context...');
    const marketContext = await getMarketContext();

    // Step 2 + 3 + 4: Score long candidates (also prefetches BTC candle cache)
    console.log(`  [2/4] Analyzing long candidates (BTC regime: ${marketContext.regime})...`);
    const rankings = await scoreAndRankCoins(marketContext);

    // Step 5: Score short candidates (reuses BTC candle cache from step 2)
    console.log('  [3/4] Analyzing short candidates...');
    const shortCandidates = await scoreAndRankShorts(marketContext);

    // Symmetry / market indecision check
    // If both long and short signals are weak there is no high-confidence trade
    const maxRsScore  = rankings.length > 0
      ? Math.max(...rankings.map((c) => c.rsScore))
      : 0;
    const maxRwScore  = shortCandidates.length > 0
      ? Math.max(...shortCandidates.map((s) => s.rwScore))
      : 0;
    const marketIndecision = maxRsScore < 40 && maxRwScore < 0.4;

    // Step 6: Assemble output
    const paused = !marketContext.allowFullScan;
    output = {
      timestamp,
      marketContext,
      rankings,
      shortCandidates,
      marketIndecision,
      paused,
      pauseReason: paused ? 'BTC impulsively dumping — reduced output' : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  [ERROR] Run failed: ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    setStatus('error', msg);
    io.emit('scan:error', { message: msg });
    return;
  }

  // Step 4: Print output to terminal
  console.log('  [4/4] Rendering output...');
  printOutput(output);
  printSummaryLine(output);

  // Step 7: Push to web dashboard
  setLatest(output);
  io.emit('scan:complete', getSnapshot());

  // Step 8: Send Telegram update (no-op if not configured)
  await sendTelegramUpdate(output);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        STRONG COIN FINDER — STARTING         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Schedule: ${RUN_CRON}`);
  console.log('  Data:     Binance public API (no key required)');
  console.log('  Press Ctrl+C to stop.\n');

  // Start web dashboard
  startWebServer();

  // Run immediately on start
  await run();

  // Then schedule future runs
  cron.schedule(RUN_CRON, async () => {
    await run();
  });

  console.log(`\n  Next run scheduled via cron: ${RUN_CRON}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
