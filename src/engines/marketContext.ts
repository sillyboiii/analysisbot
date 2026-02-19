import { getSpotCandles, pctChange } from '../data/binance';
import { BTC_REGIME, MAX_OUTPUT_COINS } from '../config';
import { BtcRegime, MarketContext } from '../types';

/**
 * Step 1 — Market Context Filter
 *
 * Reads BTC 1H and 4H candles to classify the current market regime.
 * The regime gates how aggressively the bot scans and how many coins it outputs.
 */
export async function getMarketContext(): Promise<MarketContext> {
  // Fetch BTC on 1H (last 5 candles) and 4H (last 5 candles)
  const [candles1h, candles4h] = await Promise.all([
    getSpotCandles('BTCUSDT', '1h', 5),
    getSpotCandles('BTCUSDT', '4h', 5),
  ]);

  const btcChange1h = pctChange(candles1h);
  const btcChange4h = pctChange(candles4h);

  const regime = classifyRegime(btcChange1h, btcChange4h);
  const { description, allowFullScan, maxOutputCoins } = regimeMeta(regime);

  return {
    regime,
    btcChangePercent1h: btcChange1h,
    btcChangePercent4h: btcChange4h,
    description,
    allowFullScan,
    maxOutputCoins,
  };
}

function classifyRegime(change1h: number, change4h: number): BtcRegime {
  // Priority: check for impulsive dump first
  if (
    change1h <= BTC_REGIME.impulsiveDownThreshold1h ||
    change4h <= BTC_REGIME.impulsiveDownThreshold4h
  ) {
    return 'impulsive_down';
  }

  if (change1h >= BTC_REGIME.trendingUpThreshold1h) {
    return 'trending_up';
  }

  return 'ranging';
}

function regimeMeta(regime: BtcRegime): {
  description: string;
  allowFullScan: boolean;
  maxOutputCoins: number;
} {
  switch (regime) {
    case 'trending_up':
      return {
        description: 'BTC trending up — full scan active, look for continuation setups',
        allowFullScan: true,
        maxOutputCoins: MAX_OUTPUT_COINS,
      };
    case 'ranging':
      return {
        description: 'BTC ranging — full scan active, prefer breakout/compression setups',
        allowFullScan: true,
        maxOutputCoins: MAX_OUTPUT_COINS,
      };
    case 'impulsive_down':
      return {
        description: 'BTC impulsively dumping — scan reduced, only strongest survivors shown',
        allowFullScan: false,
        maxOutputCoins: 3,
      };
  }
}
