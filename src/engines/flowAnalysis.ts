import { getSpotCandles, getOIHistory, getLatestFundingRate } from '../data/binance';
import { FLOW } from '../config';
import { FlowAnalysisResult, CrowdingRisk, OIBehavior, Candle } from '../types';

/**
 * Step 3 — Flow Analysis Engine
 *
 * Answers: Is this move backed by real participation, or is it leverage-driven?
 *
 * 3A: Spot Volume Quality
 * 3B: Open Interest Behavior
 * 3C: Funding Rate Filter
 */
export async function analyzeFlow(symbol: string): Promise<FlowAnalysisResult> {
  const perpSymbol = `${symbol}USDT`;

  // Parallel fetch: spot candles + OI history + funding rate
  const [spotCandles1h, oiHistory, fundingRate] = await Promise.all([
    getSpotCandles(perpSymbol, '1h', 30),
    getOIHistory(perpSymbol, '1h', 25).catch(() => [] as Awaited<ReturnType<typeof getOIHistory>>),
    getLatestFundingRate(perpSymbol).catch(() => 0),
  ]);

  const spotVolumeScore = scoreSpotVolume(spotCandles1h);
  const oiBehavior = classifyOI(oiHistory);
  const crowdingRisk = computeCrowdingRisk(oiBehavior, fundingRate);
  const flowScore = computeFlowScore(spotVolumeScore, oiBehavior, fundingRate, crowdingRisk);

  // Volume is considered sustained when the score is reasonably high
  const volumeSustained = spotVolumeScore >= 60;

  return {
    symbol,
    flowScore,
    spotVolumeScore,
    oiBehavior,
    fundingRate,
    crowdingRisk,
    volumeSustained,
  };
}

// ─── 3A — Spot Volume Quality ─────────────────────────────────────────────────

/**
 * Scores volume quality based on:
 * - Volume expansion on up candles vs down candles
 * - Consistency of volume (vs one-candle spikes)
 * - Trend of volume over last N candles
 */
function scoreSpotVolume(candles: Candle[]): number {
  if (candles.length < 6) return 50; // not enough data

  const recent = candles.slice(-24); // last 24 1H candles

  // Split into up candles (close > open) and down candles
  const upCandles = recent.filter((c) => c.close >= c.open);
  const downCandles = recent.filter((c) => c.close < c.open);

  const avgUpVol = avg(upCandles.map((c) => c.quoteVolume));
  const avgDownVol = avg(downCandles.map((c) => c.quoteVolume));

  // Ratio: up candles should have more volume than down candles
  const upDownRatio = avgDownVol > 0 ? avgUpVol / avgDownVol : 1;

  // Score ratio: 1.0 = neutral (50), 2.0 = great (80+), 0.5 = bad (20)
  const ratioScore = clamp(((upDownRatio - 0.5) / 1.5) * 80 + 10, 0, 90);

  // Consistency: penalise if volume is dominated by a single spike
  const volumes = recent.map((c) => c.quoteVolume);
  const maxVol = Math.max(...volumes);
  const totalVol = volumes.reduce((a, b) => a + b, 0);
  const spikeShare = maxVol / totalVol; // if one candle > 50% of total → spike

  let consistencyPenalty = 0;
  if (spikeShare > 0.5) consistencyPenalty = 20;
  else if (spikeShare > 0.35) consistencyPenalty = 10;

  // Volume trend: compare avg of last 6 vs avg of prior 12
  const last6avg = avg(volumes.slice(-6));
  const prior12avg = avg(volumes.slice(-18, -6));
  let trendBonus = 0;
  if (prior12avg > 0) {
    const expansion = last6avg / prior12avg;
    if (expansion >= FLOW.volumeExpansionRatio) trendBonus = 10;
    else if (expansion < 0.8) trendBonus = -10; // volume drying up
  }

  return Math.round(clamp(ratioScore - consistencyPenalty + trendBonus, 0, 100));
}

// ─── 3B — Open Interest Behavior ─────────────────────────────────────────────

type OIPoint = { openInterest: number; timestamp: number };

function classifyOI(oiHistory: OIPoint[]): OIBehavior {
  if (oiHistory.length < 4) {
    return {
      oiChange1h: 0,
      oiChange4h: 0,
      oiChange24h: 0,
      classification: 'neutral',
    };
  }

  const latest = oiHistory[oiHistory.length - 1].openInterest;
  const prev1h = oiHistory[Math.max(0, oiHistory.length - 2)].openInterest;
  const prev4h = oiHistory[Math.max(0, oiHistory.length - 5)].openInterest;
  const prev24h = oiHistory[0].openInterest;

  const oiChange1h = prev1h > 0 ? ((latest - prev1h) / prev1h) * 100 : 0;
  const oiChange4h = prev4h > 0 ? ((latest - prev4h) / prev4h) * 100 : 0;
  const oiChange24h = prev24h > 0 ? ((latest - prev24h) / prev24h) * 100 : 0;

  // Classify OI behaviour
  // We need price direction context — approximate from OI trend + magnitude
  let classification: OIBehavior['classification'];

  if (oiChange1h > FLOW.oiSpikeThreshold) {
    // Rapid OI build — crowded
    classification = 'crowded';
  } else if (oiChange24h < -3 && oiChange1h > 0) {
    // OI was falling (shorts building) but now recovering → short squeeze
    classification = 'short_covering';
  } else if (oiChange24h > 2 && oiChange24h < FLOW.oiSpikeThreshold) {
    // Slow steady OI build — healthy
    classification = 'healthy_build';
  } else {
    classification = 'neutral';
  }

  return { oiChange1h, oiChange4h, oiChange24h, classification };
}

// ─── 3C — Crowding Risk ───────────────────────────────────────────────────────

function computeCrowdingRisk(oi: OIBehavior, fundingRate: number): CrowdingRisk {
  let risk = 0;

  // Funding rate risk
  const fundingPct = fundingRate * 100; // convert to %
  if (fundingPct >= FLOW.fundingExtremeThreshold) risk += 3;
  else if (fundingPct >= FLOW.fundingCrowdedThreshold) risk += 2;
  else if (fundingPct < FLOW.fundingNegativeThreshold) risk += 1; // short-side risk

  // OI risk
  if (oi.classification === 'crowded') risk += 2;
  else if (oi.classification === 'short_covering') risk += 1;

  if (risk >= 4) return 'high';
  if (risk >= 2) return 'medium';
  return 'low';
}

// ─── Flow Score ───────────────────────────────────────────────────────────────

function computeFlowScore(
  spotVolumeScore: number,
  oi: OIBehavior,
  fundingRate: number,
  crowdingRisk: CrowdingRisk
): number {
  // Base from spot volume quality (0–100 already)
  let score = spotVolumeScore * 0.5;

  // OI classification bonus/penalty
  const oiBonus: Record<OIBehavior['classification'], number> = {
    healthy_build: 25,
    neutral: 15,
    short_covering: 5,
    crowded: -10,
  };
  score += oiBonus[oi.classification];

  // Funding rate bonus/penalty
  const fundingPct = fundingRate * 100;
  if (Math.abs(fundingPct) < 0.01) {
    score += 15; // ideal neutral funding
  } else if (fundingPct > 0 && fundingPct < FLOW.fundingCrowdedThreshold) {
    score += 10; // slightly positive — ok
  } else if (fundingPct >= FLOW.fundingCrowdedThreshold) {
    score -= 15; // crowded long
  } else if (fundingPct < FLOW.fundingNegativeThreshold) {
    score += 5; // slight negative — short squeeze potential
  }

  // Crowding risk final penalty
  if (crowdingRisk === 'high') score -= 20;
  else if (crowdingRisk === 'medium') score -= 8;

  return Math.round(clamp(score, 0, 100));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
