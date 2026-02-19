import { getSpotCandles, pctChange, maxDrawdown } from '../data/binance';
import { RS_THRESHOLDS } from '../config';
import { RelativeStrengthResult, Candle } from '../types';

// ─── BTC candle cache (shared across all coins in a single run) ───────────────

interface BtcCandles {
  h1: Candle[];
  h4: Candle[];
  d1: Candle[];
}

let _btcCache: BtcCandles | null = null;

export async function prefetchBtcCandles(): Promise<BtcCandles> {
  const [h1, h4, d1] = await Promise.all([
    getSpotCandles('BTCUSDT', '1h', 30),   // 30 × 1H = 30h of data
    getSpotCandles('BTCUSDT', '4h', 30),   // 30 × 4H = 5d of data
    getSpotCandles('BTCUSDT', '1d', 3),    // 3 days
  ]);
  _btcCache = { h1, h4, d1 };
  return _btcCache;
}

export function getBtcCache(): BtcCandles {
  if (!_btcCache) throw new Error('BTC candles not prefetched');
  return _btcCache;
}

// ─── RS Engine ────────────────────────────────────────────────────────────────

/**
 * Step 2 — Relative Strength Engine
 *
 * Compares a coin's performance vs BTC across 1H / 4H / 24H time windows
 * and generates a Relative Strength Score (0–100).
 *
 * High RS = coin drops less, recovers faster, holds higher lows.
 */
export async function analyzeRelativeStrength(
  symbol: string          // e.g. 'SOL'
): Promise<RelativeStrengthResult> {
  const baseSymbol = `${symbol}USDT`;
  const btc = getBtcCache();

  // Fetch coin candles for each timeframe
  const [coin1h, coin4h, coin24h] = await Promise.all([
    getSpotCandles(baseSymbol, '1h', 30),
    getSpotCandles(baseSymbol, '4h', 30),
    getSpotCandles(baseSymbol, '1d', 3),
  ]);

  // ── % changes ──────────────────────────────────────────────────────────────
  // Use the last N candles that mirror the BTC window
  const coinChange1h = pctChange(coin1h.slice(-5));
  const coinChange4h = pctChange(coin4h.slice(-5));
  const coinChange24h = pctChange(coin24h);

  const btcChange1h = pctChange(btc.h1.slice(-5));
  const btcChange4h = pctChange(btc.h4.slice(-5));
  const btcChange24h = pctChange(btc.d1);

  const rsDiff1h = coinChange1h - btcChange1h;
  const rsDiff4h = coinChange4h - btcChange4h;
  const rsDiff24h = coinChange24h - btcChange24h;

  // ── Drawdown comparison ────────────────────────────────────────────────────
  // Look at the last 24 1H candles to capture recent pullbacks
  const coinDD = maxDrawdown(coin1h.slice(-24));
  const btcDD = maxDrawdown(btc.h1.slice(-24));

  // ratio < 1 → coin drew down less than BTC (good)
  const drawdownRatio = btcDD > 0 ? coinDD / btcDD : 1;

  // ── Compute RS Score ───────────────────────────────────────────────────────
  const rsScore = computeRsScore(rsDiff1h, rsDiff4h, rsDiff24h, drawdownRatio);

  let verdict: RelativeStrengthResult['verdict'];
  if (rsScore >= RS_THRESHOLDS.strong) verdict = 'strong';
  else if (rsScore >= RS_THRESHOLDS.neutral) verdict = 'neutral';
  else verdict = 'weak';

  return {
    symbol,
    rsScore,
    coinChange1h,
    coinChange4h,
    coinChange24h,
    btcChange1h,
    btcChange4h,
    btcChange24h,
    rsDiff1h,
    rsDiff4h,
    rsDiff24h,
    drawdownRatio,
    verdict,
  };
}

// ─── Scoring logic ────────────────────────────────────────────────────────────

function computeRsScore(
  diff1h: number,
  diff4h: number,
  diff24h: number,
  drawdownRatio: number
): number {
  // Each RS diff is scored on a sigmoid-style scale
  // Positive diff = outperforming BTC, negative = underperforming

  const s1h = sigmoidScore(diff1h, 1.5);   // 1H is most sensitive
  const s4h = sigmoidScore(diff4h, 3.0);   // 4H weighted mid
  const s24h = sigmoidScore(diff24h, 5.0); // 24H is broad context

  // Weighted blend: 1H 30% / 4H 40% / 24H 30%
  const changePart = s1h * 0.30 + s4h * 0.40 + s24h * 0.30;

  // Drawdown score: ratio < 1 is good (coin held better than BTC)
  // Clamp ratio to [0.2, 2.0] then invert and normalise to [0, 1]
  const clampedRatio = Math.min(2.0, Math.max(0.2, drawdownRatio));
  const ddScore = 1 - (clampedRatio - 0.2) / 1.8;  // 0→1, higher=better

  // Combined: 70% change performance, 30% drawdown resilience
  const raw = changePart * 0.70 + ddScore * 0.30;

  return Math.round(clamp(raw * 100, 0, 100));
}

/**
 * Maps a % difference to a [0, 1] score using a smooth sigmoid.
 * @param diff   coin % change minus BTC % change
 * @param scale  controls sensitivity (larger = less sensitive)
 */
function sigmoidScore(diff: number, scale: number): number {
  // tanh gives -1..1; shift to 0..1
  return (Math.tanh(diff / scale) + 1) / 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
