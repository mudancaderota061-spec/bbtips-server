const LEAGUES = [
  { id: 1, name: "Copa" },
  { id: 2, name: "Euro" },
  { id: 3, name: "Super" },
  { id: 4, name: "Premier" },
  { id: 5, name: "Split" }
];

const MARKETS = {
  over15: {
    label: "Over 1.5",
    aliases: ["o15", "over15", "over_15", "over1.5", "over 1.5"],
    pays: score => score && score.t >= 2
  },
  over25: {
    label: "Over 2.5",
    aliases: ["o25", "over25", "over_25", "over2.5", "over 2.5"],
    pays: score => score && score.t >= 3
  },
  over35: {
    label: "Over 3.5",
    aliases: ["o35", "over35", "over_35", "over3.5", "over 3.5"],
    pays: score => score && score.t >= 4
  },
  under25: {
    label: "Under 2.5",
    aliases: ["u25", "under25", "under_25", "under2.5", "under 2.5"],
    pays: score => score && score.t <= 2
  },
  under35: {
    label: "Under 3.5",
    aliases: ["u35", "under35", "under_35", "under3.5", "under 3.5"],
    pays: score => score && score.t <= 3
  },
  ambas: {
    label: "Ambas Sim",
    aliases: ["ambs", "ambas", "ambas_sim", "ambas sim", "btts", "btts_yes"],
    pays: score => score && score.a > 0 && score.b > 0
  }
};

const state = {
  token: localStorage.getItem("virtualProToken") || "",
  username: localStorage.getItem("virtualProUser") || "",
  rows: [],
  apiErrors: [],
  lastLoadAt: null,
  selectedLeague: Number(localStorage.getItem("virtualProLeague")) || 1,
  notifyKeys: new Set(JSON.parse(localStorage.getItem("virtualProNotifyKeys") || "[]"))
};

const els = {
  loginForm: document.querySelector("#loginForm"),
  loginUser: document.querySelector("#loginUser"),
  loginPass: document.querySelector("#loginPass"),
  platform: document.querySelector("#platform"),
  market: document.querySelector("#market"),
  hours: document.querySelector("#hours"),
  windowSize: document.querySelector("#windowSize"),
  minPct: document.querySelector("#minPct"),
  minSample: document.querySelector("#minSample"),
  manualPattern: document.querySelector("#manualPattern"),
  refreshBtn: document.querySelector("#refreshBtn"),
  notifyBtn: document.querySelector("#notifyBtn"),
  sessionStatus: document.querySelector("#sessionStatus"),
  dataStatus: document.querySelector("#dataStatus"),
  leagueCards: document.querySelector("#leagueCards"),
  alerts: document.querySelector("#alerts"),
  alertCount: document.querySelector("#alertCount"),
  patternStatus: document.querySelector("#patternStatus"),
  patternStats: document.querySelector("#patternStats"),
  patternRows: document.querySelector("#patternRows"),
  chartLeague: document.querySelector("#chartLeague"),
  trendChart: document.querySelector("#trendChart"),
  boardLeague: document.querySelector("#boardLeague"),
  scoreBoard: document.querySelector("#scoreBoard"),
  nextRows: document.querySelector("#nextRows"),
  nextCount: document.querySelector("#nextCount"),
  leagueTabs: [...document.querySelectorAll("[data-league-tab]")],
  platformButtons: [...document.querySelectorAll("[data-platform-button]")]
};

function number(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseScore(value) {
  if (!value) return null;
  if (typeof value === "object" && Number.isFinite(Number(value.a)) && Number.isFinite(Number(value.b))) {
    return { a: Number(value.a), b: Number(value.b), t: Number(value.a) + Number(value.b) };
  }
  const match = String(value).match(/(\d+)\s*[-x]\s*(\d+)/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return Number.isFinite(a) && Number.isFinite(b) ? { a, b, t: a + b } : null;
}

function rowScore(row) {
  return parseScore(row?.score || row?.resultado || row?.Resultado || row?.placar || row?.Placar);
}

function rowName(row) {
  return String(row?.name || row?.jogo || row?.Jogo || row?.partida || "").trim() || "Jogo sem nome";
}

function rowTime(row) {
  return String(row?.time || row?.horario || row?.Horario || "").replace(":", ".");
}

function rowLeague(row) {
  const id = Number(row?.liga || row?.Liga);
  return Number.isFinite(id) ? id : 0;
}

function rowOdds(row) {
  const raw = row?.odds || row?.Odds || {};
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

function marketOdd(row, marketKey = els.market.value) {
  const market = MARKETS[marketKey] || MARKETS.over25;
  const odds = rowOdds(row);
  const normalized = new Map();
  for (const [key, value] of Object.entries(odds)) {
    normalized.set(normalizeText(key), number(value, NaN));
  }
  for (const alias of market.aliases) {
    const value = normalized.get(normalizeText(alias));
    if (Number.isFinite(value) && value > 1) return value;
  }
  for (const [key, value] of normalized.entries()) {
    if (market.aliases.some(alias => key.includes(normalizeText(alias))) && Number.isFinite(value) && value > 1) return value;
  }
  return 0;
}

function splitRows() {
  const validLeagues = new Set(LEAGUES.map(league => league.id));
  const rows = state.rows.filter(row => validLeagues.has(rowLeague(row)));
  const history = rows.filter(row => rowScore(row));
  const future = rows.filter(row => !rowScore(row) && row?.future !== false && marketOdd(row) > 1);
  return { history, future };
}

function rowsForLeague(rows, leagueId) {
  return rows.filter(row => rowLeague(row) === leagueId);
}

function lastRows(rows, size) {
  return rows.slice(Math.max(0, rows.length - size));
}

function hitStats(rows, marketKey) {
  const market = MARKETS[marketKey] || MARKETS.over25;
  const scored = rows.filter(row => rowScore(row));
  const hits = scored.filter(row => market.pays(rowScore(row))).length;
  return { hits, total: scored.length, pct: pct(hits, scored.length) };
}

function patternSymbol(score, marketKey, paid) {
  if (!score) return "";
  if (marketKey.startsWith("over")) return paid ? "O" : "U";
  if (marketKey.startsWith("under")) return paid ? "U" : "O";
  if (marketKey === "ambas") return paid ? "A" : "N";
  return paid ? "G" : "R";
}

function streak(rows, marketKey) {
  const market = MARKETS[marketKey] || MARKETS.over25;
  const scored = rows.filter(row => rowScore(row));
  let count = 0;
  let type = "";
  for (let i = scored.length - 1; i >= 0; i -= 1) {
    const isGreen = market.pays(rowScore(scored[i]));
    const current = isGreen ? "G" : "R";
    if (!type) type = current;
    if (current !== type) break;
    count += 1;
  }
  return { type, count };
}

function outcomeSeries(rows, marketKey) {
  const market = MARKETS[marketKey] || MARKETS.over25;
  return rows
    .map(row => {
      const score = rowScore(row);
      if (!score) return null;
      const paid = market.pays(score);
      return { row, score, token: paid ? "G" : "R", symbol: patternSymbol(score, marketKey, paid) };
    })
    .filter(Boolean);
}

function itemMatchesPattern(item, token) {
  if (!item) return false;
  if (token.includes("-")) return `${item.score.a}-${item.score.b}` === token;
  return item.token === token || item.symbol === token;
}

function findPatternStats(series, pattern, maxAfter = 4) {
  const found = [];
  if (!pattern.length) return found;
  for (let i = 0; i <= series.length - pattern.length - 1; i += 1) {
    const ok = pattern.every((token, idx) => itemMatchesPattern(series[i + idx], token));
    if (!ok) continue;
    const next = [];
    for (let step = 1; step <= maxAfter; step += 1) {
      const item = series[i + pattern.length - 1 + step];
      if (item) next.push(item);
    }
    found.push(next);
  }
  return found;
}

function bestAutomaticPattern(rows, marketKey, minSample, minPctValue) {
  const series = outcomeSeries(rows, marketKey);
  const lengths = [3, 4, 5, 6];
  let best = null;
  for (const len of lengths) {
    if (series.length <= len + 3) continue;
    const pattern = series.slice(-len).map(item => item.symbol || item.token);
    const priorSeries = series.slice(0, -1);
    const found = findPatternStats(priorSeries, pattern, 4);
    for (let step = 1; step <= 4; step += 1) {
      const sample = found.filter(items => items[step - 1]).map(items => items[step - 1]);
      const hits = sample.filter(item => item.token === "G").length;
      const rate = pct(hits, sample.length);
      const score = rate + sample.length * 1.5 + len;
      if (sample.length >= minSample && rate >= minPctValue && (!best || score > best.score)) {
        best = { type: "auto", pattern, step, sample: sample.length, hits, rate, score };
      }
    }
  }
  return best;
}

function parseManualPattern(value) {
  return String(value || "")
    .split(/[,\s>]+/)
    .map(item => item.trim().toUpperCase())
    .filter(Boolean)
    .map(item => {
      if (["G", "GREEN", "V", "VERDE"].includes(item)) return "G";
      if (["R", "RED", "VERMELHO"].includes(item)) return "R";
      if (["O", "OVER"].includes(item)) return "O";
      if (["U", "UNDER"].includes(item)) return "U";
      if (["A", "AMBAS", "BTTS"].includes(item)) return "A";
      if (["N", "NAO", "AMBASNAO"].includes(item)) return "N";
      const score = parseScore(item);
      return score ? `${score.a}-${score.b}` : "";
    })
    .filter(Boolean);
}

function bestManualPattern(rows, marketKey, manual, minSample, minPctValue) {
  const pattern = parseManualPattern(manual);
  if (!pattern.length) return null;
  const series = outcomeSeries(rows, marketKey);
  const found = findPatternStats(series, pattern, 4);
  let best = null;
  for (let step = 1; step <= 4; step += 1) {
    const sample = found.filter(items => items[step - 1]).map(items => items[step - 1]);
    const hits = sample.filter(item => item.token === "G").length;
    const rate = pct(hits, sample.length);
    const score = rate + sample.length;
    if (sample.length >= minSample && rate >= minPctValue && (!best || score > best.score)) {
      best = { type: "manual", pattern, step, sample: sample.length, hits, rate, score };
    }
  }
  return best;
}

function patternRanges(series, pattern) {
  const ranges = [];
  if (!pattern?.length) return ranges;
  for (let i = 0; i <= series.length - pattern.length; i += 1) {
    if (pattern.every((token, idx) => itemMatchesPattern(series[i + idx], token))) {
      ranges.push({ start: i, end: i + pattern.length - 1 });
    }
  }
  return ranges;
}

function scorelineStats(rows, marketKey) {
  const market = MARKETS[marketKey] || MARKETS.over25;
  const map = new Map();
  for (const row of rows) {
    const score = rowScore(row);
    if (!score) continue;
    const key = `${score.a}-${score.b}`;
    const item = map.get(key) || { score: key, total: 0, hits: 0 };
    item.total += 1;
    if (market.pays(score)) item.hits += 1;
    map.set(key, item);
  }
  return [...map.values()]
    .map(item => ({ ...item, rate: pct(item.hits, item.total) }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate)
    .slice(0, 5);
}

function exactOddStats(rows, marketKey, odd) {
  if (!odd) return null;
  const sameOdd = rows.filter(row => Math.abs(marketOdd(row, marketKey) - odd) < 0.001);
  if (!sameOdd.length) return null;
  const stats = hitStats(sameOdd, marketKey);
  return { ...stats, odd };
}

function leagueAnalysis(league, historyRows, futureRows) {
  const marketKey = els.market.value;
  const size = number(els.windowSize.value, 120);
  const minPctValue = number(els.minPct.value, 45);
  const minSample = number(els.minSample.value, 8);
  const history = rowsForLeague(historyRows, league.id);
  const future = rowsForLeague(futureRows, league.id);
  const windowRows = lastRows(history, size);
  const stats = hitStats(windowRows, marketKey);
  const last8 = hitStats(lastRows(history, 8), marketKey);
  const seq = streak(history, marketKey);
  const auto = bestAutomaticPattern(windowRows, marketKey, minSample, minPctValue);
  const manual = bestManualPattern(windowRows, marketKey, els.manualPattern.value, minSample, minPctValue);
  const scores = scorelineStats(windowRows, marketKey);
  const bestPattern = [manual, auto].filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
  const next = future.slice(0, 6).map(row => {
    const odd = marketOdd(row, marketKey);
    const oddStats = exactOddStats(windowRows, marketKey, odd);
    const baseScore = stats.pct >= minPctValue ? 25 : 0;
    const sampleScore = stats.total >= minSample ? 10 : 0;
    const patternScore = bestPattern ? Math.min(35, Math.round(bestPattern.rate / 2)) : 0;
    const oddScore = oddStats && oddStats.total >= 3 ? Math.min(20, Math.round(oddStats.pct / 5)) : 0;
    const combo = baseScore + sampleScore + patternScore + oddScore;
    let status = "ABORTAR";
    if (combo >= 70) status = "ENTRADA";
    else if (combo >= 52) status = "OBSERVAR";
    return { row, odd, oddStats, combo, status };
  });
  return { league, history, future, windowRows, stats, last8, seq, auto, manual, bestPattern, scores, next };
}

function makeAlerts(analyses) {
  const market = MARKETS[els.market.value] || MARKETS.over25;
  const minPctValue = number(els.minPct.value, 45);
  const alerts = [];
  for (const item of analyses) {
    if (item.stats.total >= number(els.minSample.value, 8) && item.stats.pct >= minPctValue) {
      alerts.push({
        tone: "good",
        title: `${item.league.name}: minima batida`,
        text: `${market.label} ${item.stats.hits}/${item.stats.total} ${item.stats.pct}%. Ultimos 8: ${item.last8.hits}/${item.last8.total}. Sequencia: ${item.seq.count} ${item.seq.type || "-"}.`
      });
    }
    if (item.bestPattern) {
      alerts.push({
        tone: "good",
        title: `${item.league.name}: padrao ${item.bestPattern.type === "manual" ? "manual" : "automatico"}`,
        text: `${item.bestPattern.pattern.join(" ")} -> +${item.bestPattern.step} casa | ${item.bestPattern.hits}/${item.bestPattern.sample} ${item.bestPattern.rate}% para ${market.label}.`
      });
    }
    const strongScore = item.scores.find(score => score.total >= 4 && score.rate >= minPctValue);
    if (strongScore) {
      alerts.push({
        tone: "watch",
        title: `${item.league.name}: placar referencia`,
        text: `${strongScore.score} apareceu ${strongScore.total}x e pagou ${market.label} em ${strongScore.hits}/${strongScore.total} (${strongScore.rate}%).`
      });
    }
  }
  return alerts.slice(0, 18);
}

function patternCatalog(rows, marketKey) {
  const series = outcomeSeries(rows, marketKey);
  const out = [];
  for (const len of [3, 4, 5]) {
    const map = new Map();
    for (let i = 0; i <= series.length - len - 1; i += 1) {
      const key = series.slice(i, i + len).map(item => item.symbol || item.token).join("-");
      const next1 = series[i + len];
      const next2 = series[i + len + 1];
      const item = map.get(key) || { key, len, total: 0, green1: 0, green2: 0 };
      item.total += 1;
      if (next1?.token === "G") item.green1 += 1;
      if (next2?.token === "G") item.green2 += 1;
      map.set(key, item);
    }
    out.push(...map.values());
  }
  return out
    .map(item => ({
      ...item,
      rate1: pct(item.green1, item.total),
      rate2: pct(item.green2, item.total)
    }))
    .filter(item => item.total >= 2)
    .sort((a, b) => b.rate1 - a.rate1 || b.total - a.total)
    .slice(0, 8);
}

function renderPatternPanel(analyses) {
  const selected = analyses.find(item => item.league.id === state.selectedLeague) || analyses[0];
  const catalog = patternCatalog(selected.windowRows, els.market.value);
  const best = selected.bestPattern;
  els.patternStatus.textContent = best ? `${best.type === "manual" ? "manual" : "auto"} ${best.rate}%` : "sem gatilho";
  els.patternStats.innerHTML = `
    <div class="pattern-stat"><strong>${selected.windowRows.length}</strong><span>Jogos na janela</span></div>
    <div class="pattern-stat"><strong>${selected.stats.pct}%</strong><span>Taxa mercado</span></div>
    <div class="pattern-stat"><strong>${best ? best.sample : 0}</strong><span>Ocorrencias padrao</span></div>
    <div class="pattern-stat"><strong>${best ? `${best.rate}%` : "--"}</strong><span>Green no alvo</span></div>
  `;
  els.patternRows.innerHTML = catalog.length ? catalog.map(item => `
    <article class="pattern-row">
      <strong>${item.key}</strong><br>
      ${item.total} ocorrencias | Green 1: ${item.green1}/${item.total} ${item.rate1}% | Green 2: ${item.green2}/${item.total} ${item.rate2}%
    </article>
  `).join("") : `<article class="pattern-row"><strong>Sem padrao com amostra</strong><br>Aumente a janela ou aguarde mais resultados.</article>`;
}

function renderLeagueCards(analyses) {
  els.leagueCards.innerHTML = analyses.map(item => {
    const tone = item.stats.pct >= number(els.minPct.value, 45) ? "hot" : item.bestPattern ? "watch" : "cold";
    const best = item.next.find(next => next.status === "ENTRADA") || item.next.find(next => next.status === "OBSERVAR");
    return `
      <article class="league-card ${tone}">
        <div class="league-title">
          <h2>${item.league.name}</h2>
          <span class="badge">${best ? best.status : "SEM ENTRADA"}</span>
        </div>
        <div class="metric-list">
          <span>Historico: <strong>${item.history.length}</strong> resultados</span>
          <span>Janela: <strong>${item.stats.hits}/${item.stats.total} ${item.stats.pct}%</strong></span>
          <span>Ultimos 8: <strong>${item.last8.hits}/${item.last8.total}</strong></span>
          <span>Padrao: <strong>${item.bestPattern ? `${item.bestPattern.rate}% +${item.bestPattern.step}` : "--"}</strong></span>
          <span>Melhor: <strong>${best ? `${rowTime(best.row)} ${rowName(best.row)}` : "--"}</strong></span>
        </div>
      </article>
    `;
  }).join("");
}

function renderAlerts(alerts) {
  els.alertCount.textContent = String(alerts.length);
  els.alerts.innerHTML = alerts.length ? alerts.map((alert, index) => `
    <article class="alert ${alert.tone}" data-alert-index="${index}">
      <h3>${alert.title}</h3>
      <p>${alert.text}</p>
    </article>
  `).join("") : `<article class="alert bad"><h3>Sem alerta forte agora</h3><p>Aguarde minima, padrao ou placar com amostra suficiente.</p></article>`;
}

function renderBoard(historyRows) {
  const leagueId = number(els.boardLeague.value || state.selectedLeague, LEAGUES[0].id);
  const marketKey = els.market.value;
  const market = MARKETS[marketKey] || MARKETS.over25;
  const rows = lastRows(rowsForLeague(historyRows, leagueId), 240);
  els.scoreBoard.innerHTML = rows.slice(-240).map((row, index) => {
    const score = rowScore(row);
    const good = market.pays(score);
    return `<div class="score-cell ${good ? "green" : "red"}" title="${rowTime(row)} ${rowName(row)}">
      <small class="idx">${index + 1}</small>
      <span>${score ? `${score.a}-${score.b}` : "-"}</span>
      <small>${rowTime(row)}</small>
    </div>`;
  }).join("");
}

function rollingPercent(series, index, size = 8) {
  const start = Math.max(0, index - size + 1);
  const slice = series.slice(start, index + 1);
  const hits = slice.filter(item => item.token === "G").length;
  return pct(hits, slice.length);
}

function renderTrendChart(historyRows) {
  const leagueId = number(els.chartLeague.value || els.boardLeague.value, LEAGUES[0].id);
  const marketKey = els.market.value;
  const leagueRows = rowsForLeague(historyRows, leagueId);
  const chartRows = lastRows(leagueRows, 140);
  const windowRows = lastRows(leagueRows, number(els.windowSize.value, 120));
  const minSample = number(els.minSample.value, 8);
  const minPctValue = number(els.minPct.value, 45);
  const manualPattern = bestManualPattern(windowRows, marketKey, els.manualPattern.value, minSample, minPctValue);
  const autoPattern = bestAutomaticPattern(windowRows, marketKey, minSample, minPctValue);
  const patternInfo = [manualPattern, autoPattern].filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
  const series = outcomeSeries(chartRows, marketKey);
  if (!series.length) {
    els.trendChart.innerHTML = `<div class="muted" style="padding:16px">Sem resultados para desenhar o grafico.</div>`;
    return;
  }

  const width = 1200;
  const height = 330;
  const pad = { left: 42, right: 42, top: 24, bottom: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = series.map((item, index) => {
    const value = rollingPercent(series, index, 8);
    const x = pad.left + (series.length === 1 ? 0 : (index / (series.length - 1)) * plotW);
    const y = pad.top + (100 - value) / 100 * plotH;
    const previous = index ? rollingPercent(series, index - 1, 8) : value;
    const color = value === previous ? "#ffffff" : item.token === "G" ? "#15e979" : "#ff445d";
    return { ...item, value, x, y, color };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${pad.top + plotH} L${points[0].x.toFixed(1)},${pad.top + plotH} Z`;
  const bars = points.map((point, index) => {
    const x = pad.left + (index / Math.max(1, points.length - 1)) * plotW;
    const barW = Math.max(3, plotW / Math.max(points.length, 1) - 2);
    const base = pad.top + plotH;
    const barH = Math.max(2, Math.abs(point.value - 50) / 50 * 58);
    const y = point.value >= 50 ? base - barH : base;
    const fill = point.value >= 50 ? "#15e979" : "#ff445d";
    return `<rect x="${(x - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${fill}" opacity="0.72"></rect>`;
  }).join("");
  const circles = points.map(point => {
    const title = `${rowTime(point.row)} ${rowName(point.row)} ${point.score.a}-${point.score.b} ${point.value}%`;
    return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.2" fill="${point.color}" stroke="#061018" stroke-width="1.5"><title>${title}</title></circle>`;
  }).join("");
  const labels = points
    .filter((_, index) => index % Math.max(1, Math.floor(points.length / 16)) === 0 || index === points.length - 1)
    .map(point => `<text x="${point.x.toFixed(1)}" y="${height - 15}" text-anchor="middle" class="chart-label">${rowTime(point.row)}</text>`)
    .join("");
  const values = points
    .filter((_, index) => index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 12)) === 0)
    .map(point => `<text x="${point.x.toFixed(1)}" y="${(point.y - 10).toFixed(1)}" text-anchor="middle" class="chart-label ${point.value >= 55 ? "hot" : point.value <= 35 ? "cold" : ""}">${Math.round(point.value)}</text>`)
    .join("");
  let patternSvg = "";
  if (patternInfo) {
    const matches = patternRanges(series, patternInfo.pattern);
    const match = matches[matches.length - 1];
    if (match) {
      const matchPoints = points.slice(match.start, match.end + 1);
      const x1 = Math.max(pad.left, Math.min(...matchPoints.map(point => point.x)) - 12);
      const x2 = Math.min(width - pad.right, Math.max(...matchPoints.map(point => point.x)) + 12);
      const y1 = Math.max(pad.top, Math.min(...matchPoints.map(point => point.y)) - 26);
      const y2 = Math.min(pad.top + plotH, Math.max(...matchPoints.map(point => point.y)) + 26);
      const targetIndex = match.end + patternInfo.step;
      const stepW = plotW / Math.max(1, points.length - 1);
      const targetX = points[targetIndex]?.x ?? Math.min(width - pad.right, points[match.end].x + patternInfo.step * stepW);
      const targetY = points[targetIndex]?.y ?? pad.top + plotH * 0.18;
      patternSvg = `
        <rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${(y2 - y1).toFixed(1)}" rx="10" class="pattern-marker"></rect>
        <text x="${x1.toFixed(1)}" y="${Math.max(18, y1 - 8).toFixed(1)}" class="pattern-text">${patternInfo.type === "manual" ? "MANUAL" : "AUTO"} ${patternInfo.pattern.join("-")} ${patternInfo.hits}/${patternInfo.sample} ${patternInfo.rate}%</text>
        <line x1="${targetX.toFixed(1)}" x2="${targetX.toFixed(1)}" y1="${pad.top}" y2="${pad.top + plotH}" stroke="#ffd84a" stroke-width="2" stroke-dasharray="8 8"></line>
        <circle cx="${targetX.toFixed(1)}" cy="${targetY.toFixed(1)}" r="9" fill="#ffd84a" stroke="#070d13" stroke-width="2"></circle>
        <text x="${targetX.toFixed(1)}" y="${Math.max(18, targetY - 15).toFixed(1)}" text-anchor="middle" class="pattern-text">ALVO +${patternInfo.step}</text>
      `;
    }
  }

  els.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico de tendencia calculado por resultados">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#36d8ff" stop-opacity="0.18"></stop>
          <stop offset="1" stop-color="#36d8ff" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#070d13"></rect>
      ${[0, 25, 50, 75, 100].map(v => {
        const y = pad.top + (100 - v) / 100 * plotH;
        return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="#1d2f40" stroke-width="1"></line>
          <text x="12" y="${y + 4}" class="chart-label">${v}</text>`;
      }).join("")}
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + 25 / 100 * plotH}" y2="${pad.top + 25 / 100 * plotH}" stroke="#1bc765" stroke-dasharray="8 8" opacity="0.7"></line>
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + 75 / 100 * plotH}" y2="${pad.top + 75 / 100 * plotH}" stroke="#ff6677" stroke-dasharray="8 8" opacity="0.7"></line>
      ${bars}
      <path d="${area}" fill="url(#chartFill)"></path>
      <path d="${path}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
      ${circles}
      ${patternSvg}
      ${values}
      ${labels}
      <text x="${width - 116}" y="${pad.top + 20}" class="chart-label hot">Topo 75</text>
      <text x="${width - 124}" y="${pad.top + plotH - 6}" class="chart-label cold">Fundo 25</text>
    </svg>
  `;
}

function statusClass(status) {
  if (status === "ENTRADA") return "status-enter";
  if (status === "OBSERVAR") return "status-watch";
  return "status-stop";
}

function renderNextRows(analyses) {
  const market = MARKETS[els.market.value] || MARKETS.over25;
  const rows = analyses.flatMap(item => item.next.map(next => ({ ...next, league: item.league, analysis: item })));
  els.nextCount.textContent = String(rows.length);
  els.nextRows.innerHTML = rows.length ? rows.map(item => {
    const oddStats = item.oddStats ? `Odd exata ${item.oddStats.hits}/${item.oddStats.total} ${item.oddStats.pct}%` : "Odd sem base exata";
    const pattern = item.analysis.bestPattern ? `Padrao ${item.analysis.bestPattern.rate}% +${item.analysis.bestPattern.step}` : "Padrao sem gatilho";
    return `
      <tr>
        <td>${item.league.name}</td>
        <td class="nowrap">${rowTime(item.row)}</td>
        <td>${rowName(item.row)}</td>
        <td>${item.odd ? item.odd.toFixed(2) : "--"}</td>
        <td class="${statusClass(item.status)}">${item.status}<br>Combo ${item.combo}/90</td>
        <td>${market.label}: base ${item.analysis.stats.hits}/${item.analysis.stats.total} ${item.analysis.stats.pct}%<br>${oddStats}<br>${pattern}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">Sem proximos jogos com odd desse mercado.</td></tr>`;
}

function notifyAlerts(alerts) {
  if (Notification.permission !== "granted") return;
  for (const alert of alerts.slice(0, 5)) {
    const key = `${alert.title}|${alert.text}`;
    if (state.notifyKeys.has(key)) continue;
    state.notifyKeys.add(key);
    new Notification("Virtual Pro", { body: `${alert.title}: ${alert.text}` });
  }
  const keep = [...state.notifyKeys].slice(-100);
  state.notifyKeys = new Set(keep);
  localStorage.setItem("virtualProNotifyKeys", JSON.stringify(keep));
}

function render() {
  const { history, future } = splitRows();
  for (const league of LEAGUES) {
    if (!els.boardLeague.querySelector(`option[value="${league.id}"]`)) {
      const option = document.createElement("option");
      option.value = String(league.id);
      option.textContent = league.name;
      els.boardLeague.appendChild(option);
    }
    if (!els.chartLeague.querySelector(`option[value="${league.id}"]`)) {
      const option = document.createElement("option");
      option.value = String(league.id);
      option.textContent = league.name;
      els.chartLeague.appendChild(option);
    }
  }
  if (!els.boardLeague.value) els.boardLeague.value = String(state.selectedLeague);
  if (!els.chartLeague.value) els.chartLeague.value = String(state.selectedLeague);
  els.leagueTabs.forEach(button => {
    button.classList.toggle("selected", Number(button.dataset.leagueTab) === state.selectedLeague);
  });
  els.platformButtons.forEach(button => {
    button.classList.toggle("selected", button.dataset.platformButton === els.platform.value);
  });
  const analyses = LEAGUES.map(league => leagueAnalysis(league, history, future));
  const alerts = makeAlerts(analyses);
  renderLeagueCards(analyses);
  renderAlerts(alerts);
  renderPatternPanel(analyses);
  renderTrendChart(history);
  renderBoard(history);
  renderNextRows(analyses);
  if (state.lastLoadAt) {
    els.dataStatus.textContent = `${state.rows.length} linhas | ${history.length} resultados | ${future.length} proximos | ${state.lastLoadAt.toLocaleTimeString("pt-BR")}`;
  }
  notifyAlerts(alerts);
}

async function login(username, password) {
  const body = JSON.stringify({ username, password });
  const headers = { "Content-Type": "application/json" };
  let response = await fetch("/api/login", { method: "POST", headers, body });
  if (!response.ok) {
    response = await fetch("/api/admin/login", { method: "POST", headers, body });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || "login bloqueado");
  state.token = data.token;
  state.username = username;
  localStorage.setItem("virtualProToken", state.token);
  localStorage.setItem("virtualProUser", username);
  els.sessionStatus.textContent = `logado: ${username}`;
}

async function loadData() {
  if (!state.token) {
    els.sessionStatus.textContent = "Entre com login e senha para carregar.";
    return;
  }
  els.dataStatus.textContent = "Carregando dados...";
  const params = new URLSearchParams({
    platform: els.platform.value,
    hours: els.hours.value,
    limit: "1000"
  });
  const response = await fetch(`/api/scanner-data?${params}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "falha ao carregar scanner");
  }
  state.rows = Array.isArray(data.rows) ? data.rows : [];
  state.apiErrors = Array.isArray(data.apiErrors) ? data.apiErrors : [];
  state.lastLoadAt = new Date();
  render();
}

els.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await login(els.loginUser.value.trim(), els.loginPass.value);
    await loadData();
  } catch (error) {
    els.sessionStatus.textContent = `Falha no login: ${error.message}`;
  }
});

els.refreshBtn.addEventListener("click", async () => {
  try {
    await loadData();
  } catch (error) {
    els.dataStatus.textContent = `Erro: ${error.message}`;
  }
});

els.notifyBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    els.sessionStatus.textContent = "Este navegador nao suporta notificacao.";
    return;
  }
  const permission = await Notification.requestPermission();
  els.sessionStatus.textContent = permission === "granted" ? "Alertas do navegador ligados." : "Alertas do navegador bloqueados.";
});

["platform", "market", "hours", "windowSize", "minPct", "minSample", "manualPattern", "boardLeague", "chartLeague"].forEach(id => {
  els[id].addEventListener("change", render);
  els[id].addEventListener("input", render);
});

els.leagueTabs.forEach(button => {
  button.addEventListener("click", () => {
    state.selectedLeague = Number(button.dataset.leagueTab) || 1;
    localStorage.setItem("virtualProLeague", String(state.selectedLeague));
    els.boardLeague.value = String(state.selectedLeague);
    els.chartLeague.value = String(state.selectedLeague);
    render();
  });
});

els.platformButtons.forEach(button => {
  button.addEventListener("click", () => {
    els.platform.value = button.dataset.platformButton;
    loadData().catch(error => {
      els.dataStatus.textContent = `Erro: ${error.message}`;
    });
    render();
  });
});

els.boardLeague.addEventListener("change", () => {
  state.selectedLeague = number(els.boardLeague.value, 1);
  localStorage.setItem("virtualProLeague", String(state.selectedLeague));
  els.chartLeague.value = String(state.selectedLeague);
});

els.chartLeague.addEventListener("change", () => {
  state.selectedLeague = number(els.chartLeague.value, 1);
  localStorage.setItem("virtualProLeague", String(state.selectedLeague));
  els.boardLeague.value = String(state.selectedLeague);
});

if (state.username) els.loginUser.value = state.username;
if (state.token) {
  els.sessionStatus.textContent = `token salvo: ${state.username || "usuario"}`;
  loadData().catch(error => {
    els.dataStatus.textContent = `Erro: ${error.message}`;
  });
}

setInterval(() => {
  if (state.token) loadData().catch(() => {});
}, 60000);
