/**
 * Telegram output — sends a formatted scan summary to a Telegram chat.
 *
 * Requires environment variables:
 *   TELEGRAM_BOT_TOKEN   — from @BotFather
 *   TELEGRAM_CHAT_ID     — your user ID or group chat ID
 *
 * Uses Telegram HTML parse mode. One message per scan run.
 * No extra dependencies — uses axios which is already in the project.
 */

import axios from 'axios';
import { BotOutput, CoinScore, ShortScore } from '../types';

// ── Config ────────────────────────────────────────────────────────────────────

function getTelegramConfig(): { token: string; chatId: string } | null {
  const token  = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function sendTelegramUpdate(output: BotOutput): Promise<void> {
  const cfg = getTelegramConfig();
  if (!cfg) {
    // Silently skip if not configured
    return;
  }

  const text = formatMessage(output);

  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.token}/sendMessage`,
      {
        chat_id:    cfg.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10_000 },
    );
    console.log('  [Telegram] Update sent.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [Telegram] Failed to send: ${msg}`);
    // Non-fatal — don't crash the bot
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const REGIME_EMOJI: Record<string, string> = {
  trending_up:    '📈',
  ranging:        '📊',
  impulsive_down: '📉',
};

const REGIME_LABEL: Record<string, string> = {
  trending_up:    'TRENDING UP',
  ranging:        'RANGING',
  impulsive_down: 'IMPULSIVE DOWN',
};

const SETUP_LABEL: Record<string, string> = {
  continuation:       '↑ Continuation Long',
  breakout_candidate: '◈ Breakout Watch',
  pullback_entry:     '↩ Pullback Entry',
  no_trade:           '— No Setup',
};

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

function formatMessage(output: BotOutput): string {
  const { marketContext: ctx, rankings, shortCandidates, marketIndecision, paused, pauseReason, timestamp } = output;

  const time = new Date(timestamp).toUTCString().replace(':00 GMT', ' UTC').slice(5);
  const regimeEmoji = REGIME_EMOJI[ctx.regime] ?? '📊';
  const regimeLabel = REGIME_LABEL[ctx.regime] ?? ctx.regime;

  const lines: string[] = [];

  // ── Header ──
  lines.push(`◈ <b>Strong Coin Finder</b> · ${time}`);
  lines.push('');
  lines.push(
    `${regimeEmoji} BTC Regime: <b>${regimeLabel}</b>  ` +
    `1H <code>${fmtPct(ctx.btcChangePercent1h)}</code>  ` +
    `4H <code>${fmtPct(ctx.btcChangePercent4h)}</code>`,
  );

  if (paused && pauseReason) {
    lines.push('');
    lines.push(`⚠ <i>${escHtml(pauseReason)}</i>`);
  }

  // Market indecision
  if (marketIndecision) {
    lines.push('');
    lines.push('⚠ <b>Market indecision</b> — both long and short signals are weak.');
    lines.push('<i>No trade environment. Sit on hands.</i>');
    return lines.join('\n');
  }

  // ── Long candidates ──
  if (!rankings || rankings.length === 0) {
    lines.push('');
    lines.push('No long candidates this cycle.');
  } else {
    lines.push(`<b>${rankings.length}</b> long candidate${rankings.length !== 1 ? 's' : ''}`);
    lines.push('');
    lines.push('─────────────────────────');
    for (let i = 0; i < rankings.length; i++) {
      lines.push(formatCoin(rankings[i], i));
    }
  }

  // ── Short candidates ──
  if (shortCandidates && shortCandidates.length > 0) {
    lines.push('─────────────────────────');
    lines.push(`🔻 <b>${shortCandidates.length} short candidate${shortCandidates.length !== 1 ? 's' : ''}</b>`);
    lines.push('');
    for (let i = 0; i < shortCandidates.length; i++) {
      lines.push(formatShortCoin(shortCandidates[i], i));
    }
  }

  // ── Footer ──
  lines.push('─────────────────────────');
  lines.push('<i>Attention list only — YOU choose entries, size, exits.</i>');

  const message = lines.join('\n');

  // Telegram hard limit: 4096 chars
  if (message.length <= 4096) return message;

  // Trim to top 5 longs, top 3 shorts if too long
  const trimmed = formatMessage({
    ...output,
    rankings: output.rankings.slice(0, 5),
    shortCandidates: (output.shortCandidates ?? []).slice(0, 3),
  });
  return trimmed.length <= 4096
    ? trimmed
    : trimmed.slice(0, 4090) + '\n[…]';
}

function formatCoin(coin: CoinScore, index: number): string {
  const rs   = coin.rs;
  const flow = coin.flow;
  const st   = coin.structure;

  const rankIcon = RANK_EMOJI[index] ?? `#${index + 1}`;
  const setup    = SETUP_LABEL[coin.setupType] ?? coin.setupType;

  const scoreClass = coin.totalScore >= 75 ? '🟢' : coin.totalScore >= 60 ? '🟡' : '🔴';

  const lines: string[] = [];

  lines.push(
    `${rankIcon} <b>${escHtml(coin.symbol)}</b>  ` +
    `Score <b>${coin.totalScore}</b> ${scoreClass}  <i>${escHtml(setup)}</i>`,
  );

  lines.push(
    `    RS   <code>${bar(coin.rsScore)}</code> ${coin.rsScore}  ` +
    `Flow <code>${bar(coin.flowScore)}</code> ${coin.flowScore}`,
  );

  lines.push(
    `    1H <code>${fmtPct(rs.rsDiff1h)}</code> vs BTC  ` +
    `4H <code>${fmtPct(rs.rsDiff4h)}</code>  ` +
    `24H <code>${fmtPct(rs.rsDiff24h)}</code>`,
  );

  // Key flow facts
  const oiLabels: Record<string, string> = {
    healthy_build:  'OI ✓ Healthy',
    crowded:        'OI ⚠ Crowded',
    short_covering: 'OI ↑ Short Cov.',
    neutral:        'OI — Neutral',
  };
  const oiLabel = oiLabels[flow.oiBehavior.classification] ?? 'OI ?';

  const fundingStr = `Funding ${(flow.fundingRate * 100).toFixed(4)}%`;

  lines.push(`    ${oiLabel}  ·  ${fundingStr}`);

  // Structure tags (condensed)
  const tags: string[] = [];
  if (st.hasHigherHighs && st.hasHigherLows) tags.push('HH+HL');
  else if (st.hasHigherHighs)                tags.push('HH');
  tags.push(st.aboveVwap ? 'Above VWAP' : 'Below VWAP');
  if (st.compressionDetected) tags.push('Compression ◈');
  if (flow.volumeSustained)   tags.push('Vol ✓');
  if (st.failedBreakouts > 0) tags.push(`${st.failedBreakouts}× Failed BO`);

  lines.push(`    ${tags.join('  ·  ')}`);

  // Risk flags
  if (coin.riskFlags.length > 0) {
    lines.push(`    ⚠ ${coin.riskFlags.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

function formatShortCoin(short: ShortScore, index: number): string {
  const rw  = short.rw;
  const kl  = short.keyLevels;

  const rankIcon = RANK_EMOJI[index] ?? `#${index + 1}`;
  const rwPct    = (short.rwScore * 100).toFixed(0);

  const setupLabels: Record<string, string> = {
    failed_reclaim:         '✗ Failed reclaim',
    breakdown_continuation: '↓ Breakdown',
    watch_zone:             '◎ Watch zone',
    no_short:               '— No short',
  };
  const setup = setupLabels[short.shortSetupType] ?? short.shortSetupType;

  const strengthIcon =
    short.rwScore >= 0.7 ? '🔴' :
    short.rwScore >= 0.5 ? '🟠' : '🟡';

  const lines: string[] = [];

  lines.push(
    `${rankIcon} <b>${escHtml(short.symbol)}</b>  ` +
    `RW <b>${rwPct}/100</b> ${strengthIcon}  <i>${escHtml(setup)}</i>`,
  );

  lines.push(
    `    DD diff <code>+${rw.drawdownDiff.toFixed(2)}%</code>  ` +
    `LL excess <code>${rw.llCountDiff}</code>  ` +
    `Failed reclaims <code>${rw.failedReclaimCount}</code>  ` +
    `Bounce lag <code>${rw.bounceWeakness.toFixed(2)}%</code>`,
  );

  const targetStr = kl.targets
    .map((t, i) => `T${i + 1}: ${t.toFixed(4)}`)
    .join('  ');

  lines.push(
    `    → Short below <code>${kl.entryBelow.toFixed(4)}</code>  ` +
    `· Stop <code>${kl.stopAbove.toFixed(4)}</code>`,
  );
  lines.push(`    → Targets: <code>${escHtml(targetStr)}</code>`);

  lines.push('');
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 8-block Unicode progress bar */
function bar(score: number, blocks = 8): string {
  const filled = Math.round((score / 100) * blocks);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, blocks - filled));
}

/** Format a percentage with sign */
function fmtPct(v: number | undefined): string {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

/** Escape HTML special chars for Telegram HTML mode */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
