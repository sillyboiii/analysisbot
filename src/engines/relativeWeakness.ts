import { getSpotCandles, maxDrawdown } from '../data/binance';
import { getBtcCache } from './relativeStrength';
import { RelativeWeaknessResult, ShortSetupType, ShortKeyLevels, Candle } from '../types';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RelativeWeaknessAnalysis {
  rw: RelativeWeaknessResult;
  shortSetupType: ShortSetupType;
  keyLevels: ShortKeyLevels;
}

/**
 * Relative Weakness Engine
 *
 * A coin is a short candidate when it:
 *   RW1 — drops harder than BTC (drawdown differential)
 *   RW2 — keeps making more lower lows than BTC (structural damage)
 *   RW3 — fails to reclaim broken support levels (failed reclaims)
 *   RW4 — bounces weakly when BTC bounces (supply-heavy)
 *
 * Composite RW score: 0.0–1.0
 *   >= 0.7 → Prime short candidate
 *   0.4–0.7 → Conditional
 *   < 0.4  → Ignore
 */
export async function analyzeRelativeWeakness(
  symbol: string
): Promise<RelativeWeaknessAnalysis> {
  const baseSymbol = `${symbol}USDT`;
  const btc = getBtcCache();

  const coin1h = await getSpotCandles(baseSymbol, '1h', 30);

  // ── Filter A: Drawdown differential ────────────────────────────────────────
  // RW1 = coin_drawdown − btc_drawdown  (positive = coin bled more)
  const coinDD = maxDrawdown(coin1h.slice(-24));
  const btcDD  = maxDrawdown(btc.h1.slice(-24));
  const drawdownDiff = coinDD - btcDD;

  // ── Filter B: Structural damage (lower lows) ────────────────────────────────
  // RW2 = coin_LL_count − btc_LL_count
  const coinLLCount = countLowerLows(coin1h.slice(-24));
  const btcLLCount  = countLowerLows(btc.h1.slice(-24));
  const llCountDiff = Math.max(0, coinLLCount - btcLLCount);

  // ── Filter C: Failed reclaims ───────────────────────────────────────────────
  // Count how often price broke below support, wicked back up, then got rejected
  const failedReclaimCount = countFailedReclaims(coin1h.slice(-24));

  // ── Filter D: Bounce weakness ───────────────────────────────────────────────
  // RW4 = btc_bounce% − coin_bounce%  (positive = coin bounced less = supply heavy)
  const coinBounce = recentBounce(coin1h.slice(-12));
  const btcBounce  = recentBounce(btc.h1.slice(-12));
  const bounceWeakness = Math.max(0, btcBounce - coinBounce);

  // ── Normalise each component to [0, 1] ────────────────────────────────────
  // Anchors chosen so typical strong setups score near 1.0
  const rwDrawdown       = clamp(drawdownDiff    / 5, 0, 1); // 5% diff = max
  const rwStructure      = clamp(llCountDiff     / 8, 0, 1); // 8 extra LLs = max
  const rwFailedReclaims = clamp(failedReclaimCount / 5, 0, 1); // 5 = max
  const rwBounceWeakness = clamp(bounceWeakness  / 5, 0, 1); // 5% diff = max

  // ── Composite RW score (spec weights) ─────────────────────────────────────
  const rwScore =
    rwDrawdown       * 0.35 +
    rwStructure      * 0.30 +
    rwFailedReclaims * 0.20 +
    rwBounceWeakness * 0.15;

  const verdict: RelativeWeaknessResult['verdict'] =
    rwScore >= 0.7 ? 'prime' :
    rwScore >= 0.4 ? 'conditional' :
    'ignore';

  const rw: RelativeWeaknessResult = {
    symbol,
    rwScore,
    drawdownDiff,
    llCountDiff,
    failedReclaimCount,
    bounceWeakness,
    rwDrawdown,
    rwStructure,
    rwFailedReclaims,
    rwBounceWeakness,
    verdict,
  };

  const shortSetupType = determineShortSetup(coin1h, failedReclaimCount);
  const keyLevels = computeKeyLevels(coin1h);

  return { rw, shortSetupType, keyLevels };
}

// ─── Filter B helpers ─────────────────────────────────────────────────────────

/**
 * Counts 1H candles whose low sets a new lower low vs the prior 3 candles.
 */
function countLowerLows(candles: Candle[]): number {
  let count = 0;
  for (let i = 3; i < candles.length; i++) {
    const priorLow = Math.min(candles[i - 1].low, candles[i - 2].low, candles[i - 3].low);
    if (candles[i].low < priorLow) count++;
  }
  return count;
}

// ─── Filter C helpers ─────────────────────────────────────────────────────────

/**
 * Counts failed reclaim attempts:
 *   1. Prior candle closed below the recent support low
 *   2. Current candle wicks back above that level but closes below it
 *
 * This is the "wick into supply then rejection" pattern.
 */
function countFailedReclaims(candles: Candle[]): number {
  let count = 0;
  for (let i = 4; i < candles.length; i++) {
    // Support = lowest low of the 3 candles before the prior candle
    const support = Math.min(
      candles[i - 4].low,
      candles[i - 3].low,
      candles[i - 2].low,
    );
    const breakCandle = candles[i - 1];
    const curr        = candles[i];

    // Break: prior candle closed below support
    if (breakCandle.close < support) {
      // Failed reclaim: current wick reaches above support but closes back below
      if (curr.high > support && curr.close < support) {
        count++;
      }
    }
  }
  return count;
}

// ─── Filter D helpers ─────────────────────────────────────────────────────────

/**
 * Measures the % bounce from the recent low to the current close.
 */
function recentBounce(candles: Candle[]): number {
  if (candles.length < 3) return 0;
  const recentLow   = Math.min(...candles.map((c) => c.low));
  const currentClose = candles[candles.length - 1].close;
  if (recentLow <= 0) return 0;
  return ((currentClose - recentLow) / recentLow) * 100;
}

// ─── Setup type ───────────────────────────────────────────────────────────────

/**
 * Classifies the short setup quality based on chart context.
 *
 * NO SHORT if price is above VWAP (reclaiming).
 * FAILED RECLAIM if there are confirmed failed reclaims (best edge).
 * BREAKDOWN CONTINUATION if price accepted below recent swing low.
 * WATCH ZONE otherwise (broken support but choppy / undecided).
 */
function determineShortSetup(
  candles: Candle[],
  failedReclaimCount: number
): ShortSetupType {
  const currentClose = candles[candles.length - 1].close;
  const vwap = computeVwap(candles);

  // Price reclaiming VWAP → not a short
  if (currentClose >= vwap) return 'no_short';

  // Find the prior swing low (recent support)
  const swingLows = extractSwingLows(candles);
  const priorSupport = swingLows.length >= 2 ? swingLows[swingLows.length - 2] : null;

  // Still above last broken support → no short
  if (priorSupport !== null && currentClose > priorSupport) return 'no_short';

  if (failedReclaimCount >= 2) return 'failed_reclaim';

  // Price is below prior support and current candle accepted below recent LL
  const recentLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : null;
  if (recentLow !== null && currentClose < recentLow) return 'breakdown_continuation';

  return 'watch_zone';
}

// ─── Key Levels ───────────────────────────────────────────────────────────────

/**
 * Derives actionable short levels from the candle series.
 *
 * Entry  — short on acceptance below the last swing low
 * Stop   — above the most recent swing high (failed reclaim candle)
 * Targets — 2–3 prior swing lows below entry
 */
function computeKeyLevels(candles: Candle[]): ShortKeyLevels {
  const currentPrice = candles[candles.length - 1].close;
  const swingLows    = extractSwingLows(candles);
  const swingHighs   = extractSwingHighs(candles);

  // Entry: trigger short if price breaks the nearest swing low below current price
  const lowsBelow = swingLows.filter((l) => l <= currentPrice * 1.005);
  const entryBelow = lowsBelow.length > 0
    ? lowsBelow[lowsBelow.length - 1]
    : parseFloat((currentPrice * 0.995).toFixed(4));

  // Stop: above the most recent swing high (nearest supply)
  const highsAbove = swingHighs.filter((h) => h >= currentPrice * 0.995);
  const stopAbove = highsAbove.length > 0
    ? highsAbove[0]
    : parseFloat((currentPrice * 1.015).toFixed(4));

  // Targets: next 2–3 swing lows below entry
  const targets = swingLows
    .filter((l) => l < entryBelow * 0.999)
    .slice(-3)
    .reverse()
    .slice(0, 3);

  // Fallback targets if no prior lows found
  if (targets.length === 0) {
    targets.push(
      parseFloat((entryBelow * 0.975).toFixed(4)),
      parseFloat((entryBelow * 0.950).toFixed(4)),
    );
  } else if (targets.length === 1) {
    targets.push(parseFloat((targets[0] * 0.975).toFixed(4)));
  }

  return { currentPrice, entryBelow, stopAbove, targets };
}

// ─── Structural helpers ───────────────────────────────────────────────────────

function extractSwingLows(candles: Candle[]): number[] {
  const lows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    if (
      candles[i].low <= candles[i - 1].low &&
      candles[i].low <= candles[i - 2].low &&
      candles[i].low <= candles[i + 1].low &&
      candles[i].low <= candles[i + 2].low
    ) {
      lows.push(candles[i].low);
    }
  }
  return lows;
}

function extractSwingHighs(candles: Candle[]): number[] {
  const highs: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    if (
      candles[i].high >= candles[i - 1].high &&
      candles[i].high >= candles[i - 2].high &&
      candles[i].high >= candles[i + 1].high &&
      candles[i].high >= candles[i + 2].high
    ) {
      highs.push(candles[i].high);
    }
  }
  return highs;
}

function computeVwap(candles: Candle[]): number {
  let cumPV = 0;
  let cumV  = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV  += c.volume;
  }
  return cumV > 0 ? cumPV / cumV : 0;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
