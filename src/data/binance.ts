import axios, { AxiosInstance } from 'axios';
import { API } from '../config';
import { Candle, Timeframe, BinanceFundingRate } from '../types';

// ─── HTTP Clients ─────────────────────────────────────────────────────────────

function makeClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: API.timeout,
    headers: { 'Content-Type': 'application/json' },
  });
}

const spotClient = makeClient(API.binanceSpot);
const futuresClient = makeClient(API.binanceFutures);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBinanceCandle(raw: unknown[]): Candle {
  return {
    openTime: raw[0] as number,
    open: parseFloat(raw[1] as string),
    high: parseFloat(raw[2] as string),
    low: parseFloat(raw[3] as string),
    close: parseFloat(raw[4] as string),
    volume: parseFloat(raw[5] as string),
    closeTime: raw[6] as number,
    quoteVolume: parseFloat(raw[7] as string),
    trades: raw[8] as number,
  };
}

// ─── Spot Klines ──────────────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles from Binance Spot.
 * @param symbol e.g. 'SOLUSDT'
 * @param interval e.g. '1h'
 * @param limit number of candles (max 1000)
 */
export async function getSpotCandles(
  symbol: string,
  interval: Timeframe,
  limit = 100
): Promise<Candle[]> {
  const { data } = await spotClient.get<unknown[][]>('/klines', {
    params: { symbol, interval, limit },
  });
  return data.map(parseBinanceCandle);
}

// ─── Futures Klines ───────────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles from Binance Futures (perpetual).
 */
export async function getFuturesCandles(
  symbol: string,
  interval: Timeframe,
  limit = 100
): Promise<Candle[]> {
  const { data } = await futuresClient.get<unknown[][]>('/klines', {
    params: { symbol, interval, limit },
  });
  return data.map(parseBinanceCandle);
}

// ─── Open Interest History ────────────────────────────────────────────────────

export interface OIPoint {
  symbol: string;
  openInterest: number;
  timestamp: number;
}

/**
 * Fetch open interest history (max 500 entries).
 * period: '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d'
 */
export async function getOIHistory(
  symbol: string,
  period = '1h',
  limit = 25
): Promise<OIPoint[]> {
  const { data } = await futuresClient.get<Array<{ sumOpenInterest: string; timestamp: number }>>(
    '/openInterestHist',
    { params: { symbol, period, limit } }
  );
  return data.map((d) => ({
    symbol,
    openInterest: parseFloat(d.sumOpenInterest),
    timestamp: d.timestamp,
  }));
}

// ─── Current Open Interest ────────────────────────────────────────────────────

export async function getCurrentOI(symbol: string): Promise<number> {
  const { data } = await futuresClient.get<{ openInterest: string }>('/openInterest', {
    params: { symbol },
  });
  return parseFloat(data.openInterest);
}

// ─── Funding Rate ─────────────────────────────────────────────────────────────

/**
 * Get the latest funding rate for a perp symbol.
 * Returns the rate as a decimal (e.g. 0.0001 = 0.01%)
 */
export async function getLatestFundingRate(symbol: string): Promise<number> {
  const { data } = await futuresClient.get<BinanceFundingRate[]>('/fundingRate', {
    params: { symbol, limit: 1 },
  });
  if (!data || data.length === 0) return 0;
  return parseFloat(data[0].fundingRate);
}

// ─── 24h Ticker ───────────────────────────────────────────────────────────────

export interface Ticker24h {
  symbol: string;
  priceChangePercent: number;
  lastPrice: number;
  volume: number;
  quoteVolume: number;
}

export async function get24hTicker(symbol: string, useSpot = true): Promise<Ticker24h> {
  const client = useSpot ? spotClient : futuresClient;
  const { data } = await client.get<{
    symbol: string;
    priceChangePercent: string;
    lastPrice: string;
    volume: string;
    quoteVolume: string;
  }>('/ticker/24hr', { params: { symbol } });

  return {
    symbol: data.symbol,
    priceChangePercent: parseFloat(data.priceChangePercent),
    lastPrice: parseFloat(data.lastPrice),
    volume: parseFloat(data.volume),
    quoteVolume: parseFloat(data.quoteVolume),
  };
}

// ─── Convenience: percentage change between first and last candle close ───────

export function pctChange(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  return ((last - first) / first) * 100;
}

/**
 * Compute the maximum drawdown % from peak within the given candles.
 */
export function maxDrawdown(candles: Candle[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const c of candles) {
    if (c.high > peak) peak = c.high;
    const dd = ((peak - c.low) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}
