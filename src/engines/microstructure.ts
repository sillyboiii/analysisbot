import { getSpotCandles } from '../data/binance';
import { STRUCTURE } from '../config';
import { MicrostructureResult, SetupType, Candle } from '../types';

/**
 * Step 4 — Microstructure Engine (Price Action Based)
 *
 * No order books needed — uses candle patterns and volume behaviour.
 *
 * 4A: Structure Quality (HH/HL, VWAP, wick quality)
 * 4B: Breakout & Retest Logic
 * 4C: Compression Detection
 */
export async function analyzeMicrostructure(symbol: string): Promise<MicrostructureResult> {
  const baseSymbol = `${symbol}USDT`;

  const candles1h = await getSpotCandles(baseSymbol, '1h', STRUCTURE.lookbackCandles);

  const hasHigherHighs = detectHigherHighs(candles1h);
  const hasHigherLows = detectHigherLows(candles1h);
  const aboveVwap = isAboveVwap(candles1h);
  const wickRatio = avgWickRatio(candles1h);
  const failedBreakouts = countFailedBreakouts(candles1h);
  const compressionDetected = detectCompression(candles1h);

  const structureScore = computeStructureScore(
    hasHigherHighs,
    hasHigherLows,
    aboveVwap,
    wickRatio,
    failedBreakouts,
    compressionDetected
  );

  const setupType = determineSetupType(
    hasHigherHighs,
    hasHigherLows,
    compressionDetected,
    structureScore,
    failedBreakouts
  );

  const cleanStructure = structureScore >= 55 && failedBreakouts <= 1;

  return {
    symbol,
    structureScore,
    hasHigherHighs,
    hasHigherLows,
    aboveVwap,
    wickRatio,
    failedBreakouts,
    setupType,
    compressionDetected,
    cleanStructure,
  };
}

// ─── 4A — Structure Detection ─────────────────────────────────────────────────

/**
 * True if the last 3 swing highs are ascending.
 * Uses every other candle's high as a "swing high" proxy.
 */
function detectHigherHighs(candles: Candle[]): boolean {
  const highs = extractSwingHighs(candles);
  if (highs.length < 3) return false;
  const last3 = highs.slice(-3);
  return last3[0] < last3[1] && last3[1] < last3[2];
}

function detectHigherLows(candles: Candle[]): boolean {
  const lows = extractSwingLows(candles);
  if (lows.length < 3) return false;
  const last3 = lows.slice(-3);
  return last3[0] < last3[1] && last3[1] < last3[2];
}

/**
 * Extracts approximate swing highs by finding local maxima in closes.
 */
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

// ─── VWAP ─────────────────────────────────────────────────────────────────────

/**
 * Simple VWAP = sum(typical_price × volume) / sum(volume)
 * Current price is above VWAP when the last close exceeds it.
 */
function isAboveVwap(candles: Candle[]): boolean {
  let cumPriceVol = 0;
  let cumVol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPriceVol += typical * c.volume;
    cumVol += c.volume;
  }
  if (cumVol === 0) return false;
  const vwap = cumPriceVol / cumVol;
  const lastClose = candles[candles.length - 1].close;
  // Allow a small proximity band
  return lastClose >= vwap * (1 - STRUCTURE.vwapProximityPct / 100);
}

// ─── Wick Quality ─────────────────────────────────────────────────────────────

/**
 * Returns the average wick-to-body ratio.
 * Lower = cleaner candles (bodies dominate wicks).
 */
function avgWickRatio(candles: Candle[]): number {
  const recent = candles.slice(-12);
  const ratios = recent.map((c) => {
    const body = Math.abs(c.close - c.open);
    const topWick = c.high - Math.max(c.open, c.close);
    const bottomWick = Math.min(c.open, c.close) - c.low;
    const totalWick = topWick + bottomWick;
    // Avoid division by zero (doji candles)
    return body > 0 ? totalWick / body : 2;
  });
  return avg(ratios);
}

// ─── 4B — Failed Breakouts ────────────────────────────────────────────────────

/**
 * Counts candles that broke above a recent high then closed back below it.
 * Uses a sliding window over the last N candles.
 */
function countFailedBreakouts(candles: Candle[]): number {
  const recent = candles.slice(-16);
  let failedCount = 0;

  for (let i = 2; i < recent.length; i++) {
    // Look at the "resistance" as the highest close in the prior 3 candles
    const priorHigh = Math.max(...recent.slice(Math.max(0, i - 3), i).map((c) => c.high));
    const curr = recent[i];

    // Candle wick broke above resistance but closed below it
    if (curr.high > priorHigh && curr.close < priorHigh) {
      // Confirm it's a meaningful rejection: body didn't close above
      failedCount++;
    }
  }
  return failedCount;
}

// ─── 4C — Compression Detection ───────────────────────────────────────────────

/**
 * Compression = N consecutive candles with a tight range.
 * This is a coiling / squeeze pattern — breakout candidate.
 */
function detectCompression(candles: Candle[]): boolean {
  const window = candles.slice(-STRUCTURE.compressionWindow);
  const tightCandles = window.filter((c) => {
    const rangePct = ((c.high - c.low) / c.low) * 100;
    return rangePct <= STRUCTURE.compressionMaxRangePct;
  });
  // If 80%+ of the window is tight, call it compression
  return tightCandles.length >= Math.ceil(window.length * 0.8);
}

// ─── Structure Score ──────────────────────────────────────────────────────────

function computeStructureScore(
  hasHH: boolean,
  hasHL: boolean,
  aboveVwap: boolean,
  wickRatio: number,
  failedBreakouts: number,
  compression: boolean
): number {
  let score = 40; // baseline

  // Trend structure
  if (hasHH && hasHL) score += 25;
  else if (hasHH || hasHL) score += 12;

  // VWAP position
  if (aboveVwap) score += 15;
  else score -= 5;

  // Wick quality (lower ratio = cleaner = better)
  if (wickRatio < 0.4) score += 15;
  else if (wickRatio < STRUCTURE.maxCleanWickRatio) score += 8;
  else if (wickRatio > 1.2) score -= 15;
  else if (wickRatio > 0.8) score -= 8;

  // Failed breakout penalty
  score -= failedBreakouts * 10;

  // Compression bonus (good setup potential)
  if (compression) score += 8;

  return Math.round(clamp(score, 0, 100));
}

// ─── Setup Type ───────────────────────────────────────────────────────────────

function determineSetupType(
  hasHH: boolean,
  hasHL: boolean,
  compression: boolean,
  structureScore: number,
  failedBreakouts: number
): SetupType {
  if (structureScore < 35 || failedBreakouts >= 3) return 'no_trade';

  if (compression) return 'breakout_candidate';

  if (hasHH && hasHL) return 'continuation';

  if (hasHL && !hasHH) return 'pullback_entry';

  return 'no_trade';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
