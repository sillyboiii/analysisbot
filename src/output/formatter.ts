import chalk from 'chalk';
import { BotOutput, CoinScore, MarketContext, CrowdingRisk, SetupType } from '../types';

// ─── Main Print ───────────────────────────────────────────────────────────────

export function printOutput(output: BotOutput): void {
  const divider = chalk.gray('─'.repeat(72));
  const ts = output.timestamp.toLocaleString();

  console.log('\n' + divider);
  console.log(chalk.bold.white('  STRONG COIN FINDER') + chalk.gray(`  |  ${ts}`));
  console.log(divider);

  // Market context block
  printMarketContext(output.marketContext);
  console.log(divider);

  if (output.paused) {
    console.log(chalk.red.bold(`\n  SCAN PAUSED: ${output.pauseReason ?? 'BTC in distress'}`));
    console.log(chalk.yellow('  Showing only the strongest survivors:\n'));
  }

  if (output.rankings.length === 0) {
    console.log(chalk.yellow('\n  No coins passed all filters this cycle.'));
    console.log(chalk.gray('  This is correct behavior — do not force trades.\n'));
  } else {
    console.log(chalk.bold('\n  RANKED COINS:\n'));
    output.rankings.forEach((coin, i) => printCoin(coin, i + 1));
  }

  console.log(divider);
  console.log(chalk.gray('  These coins are worth your attention — YOU choose entries, size, and exits.'));
  console.log(divider + '\n');
}

// ─── Market Context Block ─────────────────────────────────────────────────────

function printMarketContext(ctx: MarketContext): void {
  const regimeColor =
    ctx.regime === 'trending_up' ? chalk.green :
    ctx.regime === 'ranging'     ? chalk.yellow :
    chalk.red;

  const regimeLabel =
    ctx.regime === 'trending_up' ? 'TRENDING UP' :
    ctx.regime === 'ranging'     ? 'RANGING' :
    'IMPULSIVE DOWN';

  console.log(
    `\n  BTC Regime: ${regimeColor.bold(regimeLabel)}` +
    chalk.gray(`  (1H: ${fmtPct(ctx.btcChangePercent1h)}, 4H: ${fmtPct(ctx.btcChangePercent4h)})`)
  );
  console.log(chalk.gray(`  ${ctx.description}\n`));
}

// ─── Single Coin Block ────────────────────────────────────────────────────────

function printCoin(coin: CoinScore, rank: number): void {
  const scoreColor = coin.totalScore >= 75 ? chalk.green.bold :
                     coin.totalScore >= 60 ? chalk.yellow.bold :
                     chalk.white.bold;

  const setupLabel = setupLabelMap[coin.setupType] ?? coin.setupType;
  const crowdLabel = crowdLabelMap[coin.crowdingRisk];

  console.log(
    `  ${chalk.bold.white(String(rank).padStart(2))}. ` +
    chalk.bold.cyan(coin.symbol.padEnd(8)) +
    scoreColor(`Score: ${coin.totalScore}`) +
    chalk.gray(` | ${setupLabel}`)
  );

  // Score breakdown
  console.log(chalk.gray(
    `      RS: ${bar(coin.rsScore)} ${coin.rsScore}  ` +
    `Flow: ${bar(coin.flowScore)} ${coin.flowScore}  ` +
    `Structure: ${bar(coin.structureScore)} ${coin.structureScore}`
  ));

  // RS detail
  const rs = coin.rs;
  console.log(
    chalk.gray('      RS  ') +
    fmtDiff('1H', rs.rsDiff1h) + '  ' +
    fmtDiff('4H', rs.rsDiff4h) + '  ' +
    fmtDiff('24H', rs.rsDiff24h) + '  ' +
    chalk.gray(`DD ratio: ${rs.drawdownRatio.toFixed(2)}`)
  );

  // Flow detail
  const flow = coin.flow;
  const oiClass = oiLabelMap[flow.oiBehavior.classification] ?? flow.oiBehavior.classification;
  const fundingStr = `${(flow.fundingRate * 100).toFixed(4)}%`;
  const fundingColor = Math.abs(flow.fundingRate * 100) < 0.01 ? chalk.green :
                       flow.fundingRate * 100 > 0.05 ? chalk.red :
                       chalk.yellow;
  console.log(
    chalk.gray('      Flow ') +
    chalk.gray(`OI: ${oiClass}  `) +
    chalk.gray('Funding: ') + fundingColor(fundingStr) +
    chalk.gray(`  Crowd: ${crowdLabel}`)
  );

  // Structure detail
  const s = coin.structure;
  const hhhl = s.hasHigherHighs && s.hasHigherLows ? chalk.green('HH+HL') :
               s.hasHigherHighs ? chalk.yellow('HH') :
               s.hasHigherLows  ? chalk.yellow('HL') :
               chalk.gray('No trend');
  console.log(
    chalk.gray('      Struct ') +
    hhhl +
    chalk.gray(`  VWAP: ${s.aboveVwap ? '↑above' : '↓below'}`) +
    chalk.gray(`  Wicks: ${s.wickRatio.toFixed(2)}`) +
    (s.compressionDetected ? chalk.cyan('  [COMPRESSION]') : '') +
    (s.failedBreakouts > 0 ? chalk.yellow(`  ${s.failedBreakouts} failed BO`) : '')
  );

  // Risk flags
  if (coin.riskFlags.length > 0) {
    console.log(chalk.yellow('      RISKS: ') + chalk.yellow(coin.riskFlags.join(' | ')));
  }

  console.log('');
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function fmtPct(n: number): string {
  const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  return n >= 0 ? chalk.green(s) : chalk.red(s);
}

function fmtDiff(label: string, diff: number): string {
  const arrow = diff >= 0 ? '▲' : '▼';
  const color = diff >= 0.5 ? chalk.green : diff <= -0.5 ? chalk.red : chalk.gray;
  return chalk.gray(label + ': ') + color(`${arrow}${Math.abs(diff).toFixed(2)}%`);
}

/** Mini ASCII bar (0–100 input, 10-char wide) */
function bar(score: number): string {
  const filled = Math.round(clamp(score, 0, 100) / 10);
  const empty = 10 - filled;
  const color = score >= 70 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

const setupLabelMap: Record<SetupType, string> = {
  continuation: chalk.green('Continuation long'),
  breakout_candidate: chalk.cyan('Breakout watch'),
  pullback_entry: chalk.yellow('Pullback entry'),
  no_trade: chalk.gray('No trade'),
};

const crowdLabelMap: Record<CrowdingRisk, string> = {
  low: chalk.green('Low'),
  medium: chalk.yellow('Medium'),
  high: chalk.red('High'),
};

const oiLabelMap: Record<string, string> = {
  healthy_build: chalk.green('Healthy build'),
  crowded: chalk.red('Crowded'),
  short_covering: chalk.yellow('Short covering'),
  neutral: chalk.gray('Neutral'),
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ─── Summary line for logs ────────────────────────────────────────────────────

export function printSummaryLine(output: BotOutput): void {
  const symbols = output.rankings.map((c) => c.symbol).join(', ');
  const regime = output.marketContext.regime.toUpperCase().replace('_', ' ');
  console.log(
    chalk.gray(`[${output.timestamp.toISOString()}]`) +
    ` BTC: ${regime}  | Top coins: ${symbols || 'none'}`
  );
}
