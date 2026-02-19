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
import { scoreAndRankCoins } from './engines/scorer';
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
    console.log('  [1/3] Fetching BTC market context...');
    const marketContext = await getMarketContext();

    // Step 2 + 3 + 4: Score all coins
    console.log(`  [2/3] Analyzing coins (BTC regime: ${marketContext.regime})...`);
    const rankings = await scoreAndRankCoins(marketContext);

    // Step 5: Assemble output
    const paused = !marketContext.allowFullScan;
    output = {
      timestamp,
      marketContext,
      rankings,
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

  // Step 6: Print output to terminal
  console.log('  [3/3] Rendering output...');
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
