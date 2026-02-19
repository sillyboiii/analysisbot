/* ── Strong Coin Finder — Dashboard App ─────────────────────────────────── */

const socket = io();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $liveBadge    = document.getElementById('liveBadge');
const $scanSpinner  = document.getElementById('scanSpinner');
const $lastUpdated  = document.getElementById('lastUpdated');
const $regimeDot    = document.getElementById('regimeDot');
const $regimeLabel  = document.getElementById('regimeLabel');
const $regimeBtc1h  = document.getElementById('regimeBtc1h');
const $regimeBtc4h  = document.getElementById('regimeBtc4h');
const $regimeDesc   = document.getElementById('regimeDesc');
const $pausedNotice = document.getElementById('pausedNotice');
const $emptyState   = document.getElementById('emptyState');
const $coinGrid     = document.getElementById('coinGrid');

// ── Socket events ─────────────────────────────────────────────────────────────

socket.on('connect', () => {
  $liveBadge.textContent = 'LIVE';
  $liveBadge.classList.remove('disconnected');
});

socket.on('disconnect', () => {
  $liveBadge.textContent = 'OFFLINE';
  $liveBadge.classList.add('disconnected');
});

socket.on('init', (snapshot) => renderSnapshot(snapshot));
socket.on('scan:start', () => setScanningState(true));
socket.on('scan:complete', (snapshot) => {
  setScanningState(false);
  renderSnapshot(snapshot);
});
socket.on('scan:error', ({ message }) => {
  setScanningState(false);
  console.error('Scan error:', message);
});

// ── Rendering ─────────────────────────────────────────────────────────────────

function setScanningState(scanning) {
  $scanSpinner.classList.toggle('hidden', !scanning);
}

function renderSnapshot(snapshot) {
  if (!snapshot || !snapshot.latest) {
    show($emptyState);
    hide($coinGrid);
    hide($pausedNotice);
    return;
  }

  const { latest } = snapshot;
  renderRegime(latest.marketContext);
  renderCoins(latest.rankings, latest.paused, latest.pauseReason);
  const ts = new Date(latest.timestamp);
  $lastUpdated.dataset.ts = ts.toISOString();
  $lastUpdated.textContent = 'Updated ' + timeAgo(ts);
}

// ── BTC Regime banner ─────────────────────────────────────────────────────────

const REGIME_MAP = {
  trending_up:    { cls: 'up',    label: 'TRENDING UP',     dotCls: 'up' },
  ranging:        { cls: 'range', label: 'RANGING',          dotCls: 'range' },
  impulsive_down: { cls: 'down',  label: 'IMPULSIVE DOWN',  dotCls: 'down' },
};

function renderRegime(ctx) {
  if (!ctx) return;
  const meta = REGIME_MAP[ctx.regime] || REGIME_MAP.ranging;

  $regimeDot.className  = 'regime-dot ' + meta.dotCls;
  $regimeLabel.className = 'regime-label ' + meta.cls;
  $regimeLabel.textContent = meta.label;
  $regimeDesc.textContent  = ctx.description || '';

  $regimeBtc1h.innerHTML = 'BTC 1H: ' + pctSpan(ctx.btcChangePercent1h);
  $regimeBtc4h.innerHTML = 'BTC 4H: ' + pctSpan(ctx.btcChangePercent4h);
}

// ── Coin grid ─────────────────────────────────────────────────────────────────

function renderCoins(coins, paused, pauseReason) {
  toggleEl($pausedNotice, paused);
  if (paused && pauseReason) {
    $pausedNotice.querySelector('strong').textContent = pauseReason;
  }

  if (!coins || coins.length === 0) {
    show($emptyState);
    hide($coinGrid);
    $emptyState.querySelector('p').textContent = 'No coins passed all filters this cycle.';
    $emptyState.querySelector('.empty-sub').textContent =
      'This is correct — do not force trades when nothing qualifies.';
    return;
  }

  hide($emptyState);
  show($coinGrid);

  $coinGrid.innerHTML = coins.map((coin, i) => buildCoinCard(coin, i)).join('');
}

function buildCoinCard(coin, index) {
  const rank = index + 1;
  const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const scoreClass = coin.totalScore >= 75 ? 'high' : coin.totalScore >= 60 ? 'mid' : 'low';

  const setupInfo = SETUP_MAP[coin.setupType] || SETUP_MAP.no_trade;
  const rs  = coin.rs;
  const flow = coin.flow;
  const st  = coin.structure;

  // Structure tags
  const structTags = buildStructTags(st, flow);

  // Risk flags
  const riskHtml = coin.riskFlags.length > 0
    ? `<div class="risk-flags">${coin.riskFlags.map(f => {
        const critical = f.includes('CROWDED');
        return `<span class="risk-flag${critical ? ' critical' : ''}">⚠ ${f}</span>`;
      }).join('')}</div>`
    : '';

  return `
    <div class="coin-card">

      <!-- Header: rank, symbol, score -->
      <div class="card-header">
        <div class="card-rank-symbol">
          <div class="rank ${rankClass}">${rank}</div>
          <span class="symbol">${coin.symbol}</span>
        </div>
        <div class="card-score">
          <div class="score-value ${scoreClass}">${coin.totalScore}</div>
          <div class="score-label">SCORE</div>
        </div>
      </div>

      <!-- Setup type badge -->
      <span class="setup-badge ${setupInfo.cls}">${setupInfo.icon} ${setupInfo.label}</span>

      <!-- Score bars -->
      <div class="score-bars">
        ${scoreBar('Rel. Strength', coin.rsScore)}
        ${scoreBar('Flow Health',   coin.flowScore)}
        ${scoreBar('Structure',     coin.structureScore)}
      </div>

      <div class="card-divider"></div>

      <!-- RS diffs vs BTC -->
      <div class="rs-diffs">
        ${rsDiff('1H vs BTC', rs.rsDiff1h)}
        ${rsDiff('4H vs BTC', rs.rsDiff4h)}
        ${rsDiff('24H vs BTC', rs.rsDiff24h)}
      </div>

      <!-- Flow stats -->
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">OI Behaviour</span>
          <span class="stat-value ${oiClass(flow.oiBehavior.classification)}">${oiLabel(flow.oiBehavior.classification)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Funding Rate</span>
          <span class="stat-value ${fundingClass(flow.fundingRate)}">${formatFunding(flow.fundingRate)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Crowding Risk</span>
          <span class="stat-value ${crowdClass(flow.crowdingRisk)}">${flow.crowdingRisk.toUpperCase()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">DD Ratio vs BTC</span>
          <span class="stat-value ${rs.drawdownRatio < 1 ? 'pos' : rs.drawdownRatio > 1.3 ? 'neg' : 'neut'}">${rs.drawdownRatio.toFixed(2)}×</span>
        </div>
      </div>

      <!-- Structure tags -->
      <div class="struct-tags">${structTags}</div>

      ${riskHtml}
    </div>
  `;
}

// ── Component helpers ─────────────────────────────────────────────────────────

function scoreBar(label, value) {
  const cls = value >= 70 ? 'green' : value >= 50 ? 'yellow' : 'red';
  return `
    <div class="score-row">
      <span class="score-row-label">${label}</span>
      <div class="bar-track">
        <div class="bar-fill ${cls}" style="width:${value}%"></div>
      </div>
      <span class="score-row-value">${value}</span>
    </div>`;
}

function rsDiff(label, diff) {
  const cls  = diff >= 0.5 ? 'pos' : diff <= -0.5 ? 'neg' : 'neut';
  const arrow = diff >= 0.5 ? '▲' : diff <= -0.5 ? '▼' : '—';
  const sign  = diff > 0 ? '+' : '';
  return `
    <div class="rs-diff-item">
      <span class="rs-diff-tf">${label}</span>
      <span class="rs-diff-val ${cls}">${arrow} ${sign}${diff.toFixed(2)}%</span>
    </div>`;
}

function buildStructTags(st, flow) {
  const tags = [];
  if (st.hasHigherHighs && st.hasHigherLows) tags.push('<span class="tag green">HH + HL</span>');
  else if (st.hasHigherHighs) tags.push('<span class="tag yellow">Higher Highs</span>');
  else if (st.hasHigherLows)  tags.push('<span class="tag yellow">Higher Lows</span>');
  if (st.aboveVwap)           tags.push('<span class="tag green">Above VWAP</span>');
  else                        tags.push('<span class="tag dim">Below VWAP</span>');
  if (st.compressionDetected) tags.push('<span class="tag cyan">Compression ◈</span>');
  if (flow.volumeSustained)   tags.push('<span class="tag green">Vol. Sustained</span>');
  if (st.failedBreakouts > 0) tags.push(`<span class="tag red">${st.failedBreakouts} Failed BO</span>`);
  return tags.join('');
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

const SETUP_MAP = {
  continuation:      { cls: 'continuation', icon: '↑', label: 'Continuation Long' },
  breakout_candidate:{ cls: 'breakout',     icon: '◈', label: 'Breakout Watch' },
  pullback_entry:    { cls: 'pullback',     icon: '↩', label: 'Pullback Entry' },
  no_trade:          { cls: 'no-trade',     icon: '—', label: 'No Setup' },
};

function oiLabel(cls) {
  return { healthy_build: 'Healthy Build', crowded: 'Crowded', short_covering: 'Short Covering', neutral: 'Neutral' }[cls] || cls;
}

function oiClass(cls) {
  return { healthy_build: 'pos', crowded: 'neg', short_covering: 'warn', neutral: 'neut' }[cls] || 'neut';
}

function fundingClass(rate) {
  const pct = rate * 100;
  if (Math.abs(pct) < 0.01) return 'pos';
  if (pct > 0.05) return 'neg';
  if (pct < -0.02) return 'warn';
  return 'neut';
}

function formatFunding(rate) {
  return (rate * 100).toFixed(4) + '%';
}

function crowdClass(risk) {
  return { low: 'pos', medium: 'warn', high: 'neg' }[risk] || 'neut';
}

function pctSpan(v) {
  if (v == null) return '<span>—</span>';
  const sign = v >= 0 ? '+' : '';
  const cls  = v >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">${sign}${v.toFixed(2)}%</span>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function timeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  return Math.floor(secs / 3600) + 'h ago';
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function toggleEl(el, visible) { visible ? show(el) : hide(el); }

// Refresh "updated X ago" every minute
setInterval(() => {
  // Trigger a re-render of the timestamp only
  const el = document.getElementById('lastUpdated');
  if (el && el.dataset.ts) {
    el.textContent = 'Updated ' + timeAgo(new Date(el.dataset.ts));
  }
}, 60_000);
