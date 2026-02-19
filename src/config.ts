// ─── Coin Watchlist ───────────────────────────────────────────────────────────
// These are scanned on every run. Add or remove coins here.
// All must have liquid perp markets on Binance Futures (USDT-margined).

export const WATCHLIST: string[] = [
  'SOL',
  'ETH',
  'BNB',
  'AVAX',
  'LINK',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'APT',
  'DOGE',
  'MATIC',
  'ATOM',
  'DOT',
  'NEAR',
  'FTM',
  'TIA',
  'SEI',
  'WIF',
  'BONK',
];

// ─── Composite Score Weights ──────────────────────────────────────────────────
// Must sum to 1.0

export const WEIGHTS = {
  relativeStrength: 0.40,
  flowHealth: 0.35,
  structureQuality: 0.25,
} as const;

// ─── Output Limits ────────────────────────────────────────────────────────────

export const MAX_OUTPUT_COINS = 10;
export const MIN_OUTPUT_COINS = 3;

// ─── BTC Regime Thresholds ────────────────────────────────────────────────────

export const BTC_REGIME = {
  // 1h change below this = impulsive dump
  impulsiveDownThreshold1h: -2.5,
  // 4h change below this = confirmed down trend
  impulsiveDownThreshold4h: -4.0,
  // 1h change above this = clear trend up
  trendingUpThreshold1h: 1.0,
} as const;

// ─── Relative Strength Thresholds ────────────────────────────────────────────

export const RS_THRESHOLDS = {
  strong: 65,   // RS score >= 65 = strong
  neutral: 40,  // RS score 40–64 = neutral, below = weak
} as const;

// ─── Flow Thresholds ─────────────────────────────────────────────────────────

export const FLOW = {
  // Funding rate above this = crowded long risk
  fundingCrowdedThreshold: 0.05,   // 0.05% per 8h
  // Funding rate above this = extreme — high risk
  fundingExtremeThreshold: 0.1,    // 0.1% per 8h
  // Funding rate below this = short squeeze risk (negative)
  fundingNegativeThreshold: -0.02,
  // OI % change per hour that counts as a "spike"
  oiSpikeThreshold: 5.0,
  // Minimum volume expansion ratio vs 4-candle avg to count as sustained
  volumeExpansionRatio: 1.3,
} as const;

// ─── Microstructure Thresholds ────────────────────────────────────────────────

export const STRUCTURE = {
  // Wick/body ratio above this = choppy/indecisive
  maxCleanWickRatio: 0.6,
  // How many recent 1h candles to inspect for structure
  lookbackCandles: 24,
  // Percentage deviation from VWAP that still counts as "at VWAP"
  vwapProximityPct: 0.5,
  // Number of candles to define "compression" (low range candles)
  compressionWindow: 6,
  // Max range % for a candle to be considered "compression"
  compressionMaxRangePct: 1.5,
} as const;

// ─── Scoring Cutoffs ─────────────────────────────────────────────────────────

export const SCORE_CUTOFFS = {
  // Minimum total score to appear in output
  minTotalScore: 45,
  // Score penalty for high crowding risk
  crowdingHighPenalty: 15,
  // Score penalty for medium crowding risk
  crowdingMediumPenalty: 7,
} as const;

// ─── API ─────────────────────────────────────────────────────────────────────

export const API = {
  binanceSpot: 'https://api.binance.com/api/v3',
  binanceFutures: 'https://fapi.binance.com/fapi/v1',
  // ms between individual API calls (rate limit safety)
  requestDelay: 120,
  // request timeout ms
  timeout: 10000,
} as const;

// ─── Run Schedule ─────────────────────────────────────────────────────────────
// Cron expression: every hour at :00
// Change to e.g. '*/30 * * * *' for every 30 minutes

export const RUN_CRON = '0 * * * *';
