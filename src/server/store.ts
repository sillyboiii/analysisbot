import { BotOutput } from '../types';

/**
 * In-memory store for the latest bot output.
 * The web server reads from this; the bot runner writes to it.
 */

export type ScanStatus = 'idle' | 'scanning' | 'error';

interface Store {
  latest: BotOutput | null;
  history: BotOutput[];       // last N runs
  status: ScanStatus;
  lastError: string | null;
  startedAt: Date | null;
}

const MAX_HISTORY = 20;

const store: Store = {
  latest: null,
  history: [],
  status: 'idle',
  lastError: null,
  startedAt: null,
};

export function setStatus(status: ScanStatus, error?: string): void {
  store.status = status;
  store.lastError = error ?? null;
  if (status === 'scanning') store.startedAt = new Date();
}

export function setLatest(output: BotOutput): void {
  store.latest = output;
  store.status = 'idle';
  store.startedAt = null;
  // Prepend to history, cap at MAX_HISTORY
  store.history = [output, ...store.history].slice(0, MAX_HISTORY);
}

export function getLatest(): BotOutput | null {
  return store.latest;
}

export function getHistory(): BotOutput[] {
  return store.history;
}

export function getStatus(): ScanStatus {
  return store.status;
}

export function getSnapshot() {
  return {
    latest: store.latest,
    status: store.status,
    lastError: store.lastError,
    startedAt: store.startedAt,
    historyLength: store.history.length,
  };
}
