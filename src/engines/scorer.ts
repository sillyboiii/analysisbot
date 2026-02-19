import { sleep } from '../data/binance';
import { analyzeRelativeStrength, prefetchBtcCandles } from './relativeStrength';
import { analyzeFlow } from './flowAnalysis';
import { analyzeMicrostructure } from './microstructure';
import { WATCHLIST, WEIGHTS, SCORE_CUTOFFS, API } from '../config';
import { CoinScore, MarketContext, RelativeStrengthResult, FlowAnalysisResult, MicrostructureResult } from '../types';

/**
 * Step 5 — Scoring & Ranking Engine
 *
 * Composite score formula:
 *   Total = (RS × 40%) + (Flow × 35%) + (Structure × 25%)
 *
 * Filters applied after scoring:
 *   - Remove high crowding risk coins
 *   - Remove coins with no-trade structure
 *   - Remove coins below min total score
 *   - Respect market context output limit
 */
export async function scoreAndRankCoins(
  context: MarketContext
): Promise<CoinScore[]> {
  console.log('  Prefetching BTC baseline candles...');
  await prefetchBtcCandles();

  const coins = WATCHLIST;
  const results: CoinScore[] = [];

  console.log(`  Analyzing ${coins.length} coins...`);

  for (const symbol of coins) {
    try {
      const score = await analyzeCoin(symbol);
      if (score) results.push(score);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN] ${symbol}: skipped — ${msg}`);
    }
    // Respect rate limits between coins
    await sleep(API.requestDelay);
  }

  return rankAndFilter(results, context);
}

// ─── Per-coin Analysis ────────────────────────────────────────────────────────

async function analyzeCoin(symbol: string): Promise<CoinScore | null> {
  // Run RS, flow, and structure analysis (some can be parallel)
  // Flow and microstructure are independent; RS needs BTC cache (already done)
  const [rs, flow, structure] = await Promise.all([
    analyzeRelativeStrength(symbol),
    analyzeFlow(symbol),
    analyzeMicrostructure(symbol),
  ]);

  const { totalScore, riskFlags, verdict } = computeComposite(rs, flow, structure);

  return {
    symbol,
    totalScore,
    rsScore: rs.rsScore,
    flowScore: flow.flowScore,
    structureScore: structure.structureScore,
    crowdingRisk: flow.crowdingRisk,
    setupType: structure.setupType,
    riskFlags,
    verdict,
    rs,
    flow,
    structure,
  };
}

// ─── Composite Scoring ────────────────────────────────────────────────────────

function computeComposite(
  rs: RelativeStrengthResult,
  flow: FlowAnalysisResult,
  structure: MicrostructureResult
): { totalScore: number; riskFlags: string[]; verdict: string } {
  // Raw weighted composite
  let score =
    rs.rsScore * WEIGHTS.relativeStrength +
    flow.flowScore * WEIGHTS.flowHealth +
    structure.structureScore * WEIGHTS.structureQuality;

  const riskFlags: string[] = [];

  // Crowding risk penalty
  if (flow.crowdingRisk === 'high') {
    score -= SCORE_CUTOFFS.crowdingHighPenalty;
    riskFlags.push('CROWDED LONGS');
  } else if (flow.crowdingRisk === 'medium') {
    score -= SCORE_CUTOFFS.crowdingMediumPenalty;
    riskFlags.push('Elevated crowding');
  }

  // Weak RS flag
  if (rs.verdict === 'weak') {
    riskFlags.push('Underperforming BTC');
  }

  // Failed breakouts flag
  if (structure.failedBreakouts >= 2) {
    riskFlags.push(`${structure.failedBreakouts} failed breakouts`);
  }

  // Negative funding (short-side crowded)
  if (flow.fundingRate < -0.02 / 100) {
    riskFlags.push('Negative funding');
  }

  const totalScore = Math.round(clamp(score, 0, 100));
  const verdict = buildVerdict(rs, flow, structure, totalScore);

  return { totalScore, riskFlags, verdict };
}

function buildVerdict(
  rs: RelativeStrengthResult,
  flow: FlowAnalysisResult,
  structure: MicrostructureResult,
  score: number
): string {
  const rsDesc = rs.verdict === 'strong' ? 'Strong vs BTC' : rs.verdict === 'neutral' ? 'Neutral vs BTC' : 'Weak vs BTC';
  const flowDesc = flow.oiBehavior.classification === 'healthy_build'
    ? 'Healthy OI build'
    : flow.oiBehavior.classification === 'crowded'
    ? 'Crowded OI'
    : flow.volumeSustained
    ? 'Sustained spot volume'
    : 'Low participation';

  const setupDesc: Record<string, string> = {
    continuation: 'Continuation long',
    breakout_candidate: 'Breakout watch',
    pullback_entry: 'Pullback entry',
    no_trade: 'No clean setup',
  };

  return `${rsDesc} | ${flowDesc} | ${setupDesc[structure.setupType] ?? 'No setup'} (score: ${score})`;
}

// ─── Ranking & Filtering ──────────────────────────────────────────────────────

function rankAndFilter(coins: CoinScore[], context: MarketContext): CoinScore[] {
  // 1. Remove hard-filtered coins
  let filtered = coins.filter((c) => {
    if (c.crowdingRisk === 'high') return false;
    if (c.setupType === 'no_trade') return false;
    if (c.totalScore < SCORE_CUTOFFS.minTotalScore) return false;
    if (c.rs.verdict === 'weak') return false;
    return true;
  });

  // 2. Sort by total score descending
  filtered.sort((a, b) => b.totalScore - a.totalScore);

  // 3. Apply market context output cap
  return filtered.slice(0, context.maxOutputCoins);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
