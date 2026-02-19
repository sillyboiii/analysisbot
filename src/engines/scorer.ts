import { sleep } from '../data/binance';
import { analyzeRelativeStrength, prefetchBtcCandles } from './relativeStrength';
import { analyzeRelativeWeakness } from './relativeWeakness';
import { analyzeFlow } from './flowAnalysis';
import { analyzeMicrostructure } from './microstructure';
import { WATCHLIST, WEIGHTS, SCORE_CUTOFFS, API } from '../config';
import { CoinScore, ShortScore, MarketContext, RelativeStrengthResult, FlowAnalysisResult, MicrostructureResult } from '../types';

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

// ─── Short Ranking ────────────────────────────────────────────────────────────

const MAX_SHORT_OUTPUT = 5;
const MIN_RW_SCORE = 0.4;
// Symmetry: don't show a coin as a short if it also has strong long signal
const MAX_RS_FOR_SHORT = 50;

/**
 * Score and rank short candidates from the watchlist.
 *
 * A coin qualifies when:
 *   - RW score >= 0.4 (meaningful structural weakness vs BTC)
 *   - RS score < 50  (symmetry check — not a strong long at the same time)
 *   - Short setup type is not 'no_short' (price hasn't reclaimed above supply)
 *
 * BTC candles must already be prefetched before calling this.
 */
export async function scoreAndRankShorts(
  _context: MarketContext
): Promise<ShortScore[]> {
  const results: ShortScore[] = [];

  for (const symbol of WATCHLIST) {
    try {
      const short = await analyzeShortCandidate(symbol);
      if (short) results.push(short);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN][short] ${symbol}: skipped — ${msg}`);
    }
    await sleep(API.requestDelay);
  }

  return results
    .filter((s) => s.rwScore >= MIN_RW_SCORE && s.shortSetupType !== 'no_short')
    .sort((a, b) => b.rwScore - a.rwScore)
    .slice(0, MAX_SHORT_OUTPUT);
}

async function analyzeShortCandidate(symbol: string): Promise<ShortScore | null> {
  // RS and RW share the same BTC cache; run them in parallel
  const [rs, rwAnalysis] = await Promise.all([
    analyzeRelativeStrength(symbol),
    analyzeRelativeWeakness(symbol),
  ]);

  // Symmetry check: coin also has strong long signal → skip
  if (rs.rsScore >= MAX_RS_FOR_SHORT) return null;

  const { rw, shortSetupType, keyLevels } = rwAnalysis;
  const verdict = buildShortVerdict(rw, shortSetupType);

  return {
    symbol,
    rwScore: rw.rwScore,
    rsScore: rs.rsScore,
    shortSetupType,
    keyLevels,
    rw,
    verdict,
  };
}

function buildShortVerdict(
  rw: import('../types').RelativeWeaknessResult,
  setupType: import('../types').ShortSetupType
): string {
  const rwDesc =
    rw.verdict === 'prime'       ? 'Prime weakness vs BTC' :
    rw.verdict === 'conditional' ? 'Conditional weakness'  :
                                   'Marginal weakness';

  const setupDesc: Record<import('../types').ShortSetupType, string> = {
    failed_reclaim:         'Failed reclaim pattern',
    breakdown_continuation: 'Breakdown continuation',
    watch_zone:             'Watch zone — not triggered',
    no_short:               'No short setup',
  };

  return `${rwDesc} | ${setupDesc[setupType]}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
