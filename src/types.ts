// ─── Candle / OHLCV ──────────────────────────────────────────────────────────

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;       // spot base volume
  closeTime: number;
  quoteVolume: number;  // USDT volume
  trades: number;
}

export type Timeframe = '15m' | '1h' | '4h' | '1d';

// ─── BTC Market Context ───────────────────────────────────────────────────────

export type BtcRegime = 'trending_up' | 'ranging' | 'impulsive_down';

export interface MarketContext {
  regime: BtcRegime;
  btcChangePercent1h: number;
  btcChangePercent4h: number;
  description: string;
  allowFullScan: boolean;
  maxOutputCoins: number;
}

// ─── Relative Strength ────────────────────────────────────────────────────────

export interface RelativeStrengthResult {
  symbol: string;
  rsScore: number;           // 0–100
  coinChange1h: number;
  coinChange4h: number;
  coinChange24h: number;
  btcChange1h: number;
  btcChange4h: number;
  btcChange24h: number;
  rsDiff1h: number;          // coin - btc
  rsDiff4h: number;
  rsDiff24h: number;
  drawdownRatio: number;     // coin drawdown / btc drawdown (< 1 = coin held better)
  verdict: 'strong' | 'neutral' | 'weak';
}

// ─── Flow Analysis ────────────────────────────────────────────────────────────

export type CrowdingRisk = 'low' | 'medium' | 'high';

export interface OIBehavior {
  oiChange1h: number;
  oiChange4h: number;
  oiChange24h: number;
  classification: 'healthy_build' | 'crowded' | 'short_covering' | 'neutral';
}

export interface FlowAnalysisResult {
  symbol: string;
  flowScore: number;         // 0–100
  spotVolumeScore: number;   // 0–100
  oiBehavior: OIBehavior;
  fundingRate: number;       // current funding rate %
  crowdingRisk: CrowdingRisk;
  volumeSustained: boolean;
}

// ─── Microstructure ───────────────────────────────────────────────────────────

export type SetupType =
  | 'continuation'
  | 'breakout_candidate'
  | 'pullback_entry'
  | 'no_trade';

export interface MicrostructureResult {
  symbol: string;
  structureScore: number;    // 0–100
  hasHigherHighs: boolean;
  hasHigherLows: boolean;
  aboveVwap: boolean;
  wickRatio: number;         // avg wick / body ratio (lower = cleaner)
  failedBreakouts: number;   // count of failed BOs in recent candles
  setupType: SetupType;
  compressionDetected: boolean;
  cleanStructure: boolean;
}

// ─── Final Coin Score ─────────────────────────────────────────────────────────

export interface CoinScore {
  symbol: string;
  totalScore: number;        // 0–100 composite
  rsScore: number;
  flowScore: number;
  structureScore: number;
  crowdingRisk: CrowdingRisk;
  setupType: SetupType;
  riskFlags: string[];
  verdict: string;           // one-line human summary
  rs: RelativeStrengthResult;
  flow: FlowAnalysisResult;
  structure: MicrostructureResult;
}

// ─── Relative Weakness (Short Side) ──────────────────────────────────────────

export type ShortSetupType =
  | 'failed_reclaim'
  | 'breakdown_continuation'
  | 'watch_zone'
  | 'no_short';

export interface RelativeWeaknessResult {
  symbol: string;
  rwScore: number;            // 0.0–1.0 composite weakness score
  drawdownDiff: number;       // coin DD% − BTC DD% (positive = coin bled more)
  llCountDiff: number;        // coin lower-lows count − BTC count
  failedReclaimCount: number; // failed reclaims in last 24h
  bounceWeakness: number;     // BTC bounce% − coin bounce% (positive = coin lagged)
  rwDrawdown: number;         // normalised component 0–1
  rwStructure: number;        // normalised component 0–1
  rwFailedReclaims: number;   // normalised component 0–1
  rwBounceWeakness: number;   // normalised component 0–1
  verdict: 'prime' | 'conditional' | 'ignore';
}

export interface ShortKeyLevels {
  currentPrice: number;
  entryBelow: number;   // trigger: short on acceptance below this
  stopAbove: number;    // invalidation: close above this = out
  targets: number[];    // 2–3 downside price targets
}

export interface ShortScore {
  symbol: string;
  rwScore: number;            // 0.0–1.0
  rsScore: number;            // long RS score kept for symmetry check display
  shortSetupType: ShortSetupType;
  keyLevels: ShortKeyLevels;
  rw: RelativeWeaknessResult;
  verdict: string;            // one-line human summary
}

// ─── Bot Output ───────────────────────────────────────────────────────────────

export interface BotOutput {
  timestamp: Date;
  marketContext: MarketContext;
  rankings: CoinScore[];
  shortCandidates: ShortScore[];
  marketIndecision: boolean;  // true when both RS and RW signals are weak
  paused: boolean;
  pauseReason?: string;
}

// ─── Raw API types ────────────────────────────────────────────────────────────

export interface BinanceTicker24h {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
}

export interface BinanceOpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

export interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}
