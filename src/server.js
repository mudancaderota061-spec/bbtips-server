import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || "troque-essa-chave";
const adminUser = process.env.ADMIN_USER || "admin";
const adminPass = process.env.ADMIN_PASS || "admin123";
const scannerApiCache = new Map();
const scannerScheduleTimeZone = "Europe/London";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL nao definido. No Railway, adicione um Postgres ao projeto.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : undefined
});

app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(cors({ origin: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

function tokenFor(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", jwtSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", jwtSecret).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = readToken(token);
  if (!payload || payload.type !== "admin") {
    return res.status(401).json({ ok: false, error: "admin nao autorizado" });
  }
  next();
}

function requireUserOrAdmin(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = readToken(token);
  if (!payload || !["user", "admin"].includes(payload.type)) {
    return res.status(401).json({ ok: false, error: "nao autorizado" });
  }
  req.auth = payload;
  next();
}

function endOfBrazilDay(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(value);
  const [, y, m, d] = match;
  return new Date(`${y}-${m}-${d}T23:59:59-03:00`);
}

function normalizeScannerHours(value) {
  const match = String(value || "").match(/(?:Horas)?\s*(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return [3, 5, 6, 12, 24, 48].includes(n) ? `Horas${n}` : null;
}

function scannerHoursFromUrl(url) {
  try {
    return normalizeScannerHours(new URL(url).searchParams.get("Horas"));
  } catch (_error) {
    return null;
  }
}

function scannerApiUrl(liga, futuro, platform = "BET365", hours = "Horas3") {
  const filtros = "o05,u05,o15,u15,o25,u25,o35,u35,ambs,ambn,ge5,tgv5,tgc5,ftc,fte,ftv";
  const params = new URLSearchParams({
    liga: String(liga),
    futuro: futuro ? "true" : "false",
    Horas: normalizeScannerHours(hours) || "Horas3",
    tipoOdd: "",
    dadosAlteracao: "",
    filtros,
    confrontos: "false",
    hrsConfrontos: "240",
    plataforma: platform
  });
  return `https://api.thtips.com.br/api/futebolvirtual?${params.toString()}`;
}

function scannerScore(raw) {
  const match = String(raw || "").match(/(\d+)\s*[-x]\s*(\d+)/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return Number.isFinite(a) && Number.isFinite(b) ? { a, b, t: a + b } : null;
}

function scannerTime(row, line) {
  const h = row.Horario ?? row.horario ?? row.Hora ?? row.hora ?? line?.Horario ?? line?.horario ?? "";
  const min = row.Minuto ?? row.minuto;
  if (String(h).match(/^\d{1,2}[.:]\d{2}$/)) return String(h).replace(":", ".");
  if (h !== "" && min !== undefined) return `${Number(h)}.${String(min).padStart(2, "0")}`;
  return String(h || "");
}

function scannerParseTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : null;
}

function scannerScheduleNowMinute(at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: scannerScheduleTimeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(at);
    const h = Number(parts.find(part => part.type === "hour")?.value);
    const m = Number(parts.find(part => part.type === "minute")?.value);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  } catch (_error) {}
  const d = at instanceof Date ? at : new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

function scannerIsFutureTime(value) {
  const minute = scannerParseTime(value);
  if (minute === null) return true;
  const now = scannerScheduleNowMinute();
  let diff = minute - now;
  if (diff < -720) diff += 1440;
  return diff >= 0 && diff <= 720;
}

function scannerIsNearCollectionTime(value, collectedAt, maxAhead = 240) {
  const minute = scannerParseTime(value);
  if (minute === null) return false;
  const base = scannerScheduleNowMinute(new Date(collectedAt || Date.now()));
  let diff = minute - base;
  if (diff < 0) diff += 1440;
  return diff >= 0 && diff <= maxAhead;
}

function scannerNormalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function scannerCanonicalKey(row, liga, platform) {
  const score = row.score ? `${row.score.a}-${row.score.b}` : row.future ? "future" : "done";
  return [
    String(platform || row.platform || "").toUpperCase(),
    liga ?? row.liga ?? "",
    row.time ?? "",
    scannerNormalize(row.name || ""),
    score
  ].join("|");
}

function scannerFutureOddsKey(row, liga) {
  return [
    liga ?? row?.liga ?? "",
    row?.time ?? "",
    scannerNormalize(row?.name || "")
  ].join("|");
}

function scannerHasAnyOdd(row) {
  const odds = parseScannerOdds(row?.odds || {});
  return Object.values(odds).some(value => {
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) && n > 1;
  });
}

function scannerMergeOdds(primary, fallback) {
  return {
    ...parseScannerOdds(fallback?.odds || {}),
    ...parseScannerOdds(primary?.odds || {})
  };
}

function scannerLooksLikeOddTime(row) {
  const parsed = scannerParseTime(row?.time);
  if (parsed === null) return false;
  const rawTime = Number(String(row.time).replace(":", "."));
  if (!Number.isFinite(rawTime)) return false;
  const odds = parseScannerOdds(row?.odds || {});
  return Object.values(odds).some(value => {
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) && n.toFixed(2) === rawTime.toFixed(2);
  });
}

function scannerVisibleFutureSource(row) {
  const api = String(row?.api || "");
  return api === "dom-grid" || api === "robot-game";
}

function parseScannerOdds(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {}
  const out = {};
  String(raw).split(/[;,|\n]/).forEach(part => {
    const match = part.match(/([a-zA-Z0-9_.+]+)\s*@\s*(\d+(?:[,.]\d+)?)/);
    if (match) out[match[1].toLowerCase()] = Number(match[2].replace(",", "."));
  });
  return out;
}

function collectScannerOdds(obj, out = {}) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach(item => collectScannerOdds(item, out));
    return out;
  }
  const key = obj.Nome ?? obj.nome ?? obj.Mercado ?? obj.mercado ?? obj.Tipo ?? obj.tipo ?? obj.Chave ?? obj.chave ?? obj.Key ?? obj.key ?? obj.Name ?? obj.name;
  const value = obj.Odd ?? obj.odd ?? obj.Valor ?? obj.valor ?? obj.Value ?? obj.value ?? obj.Cotacao ?? obj.cotacao;
  if (key !== undefined && value !== undefined) out[String(key).toLowerCase()] = Number(String(value).replace(",", "."));
  ["Odds", "odds", "Odd", "odd", "Mercados", "mercados", "Markets", "markets", "Cotacoes", "cotacoes"].forEach(name => {
    if (obj[name] !== undefined) collectScannerOdds(obj[name], out);
  });
  return out;
}

function flattenScannerApi(json, url, liga) {
  const out = [];
  const lines = Array.isArray(json?.Linhas) ? json.Linhas : Array.isArray(json?.linhas) ? json.linhas : Array.isArray(json) ? json : [];
  lines.forEach((line, lineIndex) => {
    const cols = Array.isArray(line.Colunas) ? line.Colunas : Array.isArray(line.colunas) ? line.colunas : Array.isArray(line.Jogos) ? line.Jogos : [line];
    cols.forEach((col, colIndex) => {
      if (!col || typeof col !== "object") return;
      const score = scannerScore(col.Resultado || col.resultado || col.Placar || col.placar || "");
      const a = col.TimeA || col.timeA || col.Casa || col.casa || col.TimeCasa || "";
      const b = col.TimeB || col.timeB || col.Fora || col.fora || col.TimeFora || "";
      const time = scannerTime(col, line);
      const odds = Object.assign(
        {},
        parseScannerOdds(col),
        parseScannerOdds(col.Odds || col.odds || col.Odd || col.odd || col.Mercados || col.mercados || col.Markets || col.markets),
        collectScannerOdds(col)
      );
      const future = /futuro=true/i.test(url) || Boolean(col.Futuro || col.futuro || (!score && time));
      if (!a && !b && !time) return;
      out.push({
        key: [url, time, a, b, score ? `${score.a}-${score.b}` : "", lineIndex, colIndex].join("|"),
        liga,
        time,
        name: `${a} x ${b}`.trim(),
        score,
        odds,
        future,
        hours: scannerHoursFromUrl(url) || "Horas3",
        api: url,
        idx: lineIndex * 100 + colIndex
      });
    });
  });
  return out;
}

async function fetchScannerApiRows(platform = "BET365", hours = "Horas3") {
  const now = Date.now();
  const cacheKey = String(platform || "BET365").toUpperCase();
  const hoursKey = normalizeScannerHours(hours) || "Horas3";
  const cached = scannerApiCache.get(`${cacheKey}|${hoursKey}`);
  if (cached && now - cached.at < 60000) return cached;
  const rows = [];
  const errors = [];
  const ligas = [1, 2, 3, 4, 5];
  await Promise.all(ligas.flatMap(liga => [false, true].map(async futuro => {
    const url = scannerApiUrl(liga, futuro, cacheKey, hoursKey);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const json = await response.json();
      if (!response.ok) errors.push(`${liga} ${futuro ? "futuro" : "hist"} ${response.status}`);
      rows.push(...flattenScannerApi(json, url, liga).map(row => ({ ...row, platform: cacheKey })));
    } catch (error) {
      errors.push(`${liga} ${futuro ? "futuro" : "hist"} ${error.name || "erro"}`);
    }
  })));
  const next = { at: now, rows: rows.slice(-6000), errors, platform: cacheKey, hours: hoursKey };
  scannerApiCache.set(`${cacheKey}|${hoursKey}`, next);
  return next;
}

async function initDb() {
  await pool.query(`
    create table if not exists admins (
      id serial primary key,
      username text unique not null,
      password_hash text not null,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists users (
      id serial primary key,
      username text unique not null,
      password_hash text not null,
      active boolean not null default true,
      expires_at timestamptz,
      note text default '',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists telemetry (
      id serial primary key,
      username text not null,
      kind text default 'robo',
      payload jsonb not null,
      created_at timestamptz default now()
    );
  `);

  const hash = await bcrypt.hash(adminPass, 10);
  await pool.query(`
    insert into admins (username, password_hash)
    values ($1, $2)
    on conflict (username) do update set password_hash = excluded.password_hash
  `, [adminUser, hash]);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "bbtips-server" });
});

app.get("/scanner", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "scanner.html"));
});

app.get("/virtual", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "virtual.html"));
});

app.get("/api/robo.js", async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = readToken(String(token || ""));
  if (!payload || !["user", "admin"].includes(payload.type)) {
    return res
      .status(401)
      .type("application/javascript")
      .send("console.error('BBTips: login nao autorizado para carregar o robo.');");
  }
  try {
    const file = await fs.readFile(path.join(process.cwd(), "robo.js"), "utf8");
    const apiBase = `${req.protocol}://${req.get("host")}`;
    const cfg = `window.__BBTIPS_REMOTE_CONFIG=${JSON.stringify({ apiBase, token: String(token || ""), username: payload.username || "admin" })};\n`;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("application/javascript").send(cfg + file);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .type("application/javascript")
      .send("console.error('BBTips: robo.js nao encontrado no servidor.');");
  }
});

app.post("/api/telemetry", requireUserOrAdmin, async (req, res) => {
  const payload = req.body || {};
  await pool.query(
    "insert into telemetry (username, kind, payload) values ($1, $2, $3)",
    [req.auth.username || "admin", payload.kind || "robo", payload]
  );
  res.json({ ok: true });
});

app.get("/api/scanner-data", requireUserOrAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 3000));
  const telemetryEventLimit = 12;
  const username = req.auth.type === "admin" && req.query.user ? String(req.query.user) : req.auth.username;
  const rawPlatform = String(req.query.platform || "BET365").replace(/[^a-z0-9_-]/ig, "").toUpperCase();
  const platform = rawPlatform === "TODAS" ? "BET365" : rawPlatform || "BET365";
  const requestedHours = normalizeScannerHours(req.query.hours);
  let telemetry = await pool.query(`
    select username, payload, created_at
    from telemetry
    where kind = 'collector_rows'
      and ($1::text is null or username = $1)
    order by id desc
    limit $2
  `, [username || null, telemetryEventLimit]);
  let telemetryScope = "usuario";
  if (!telemetry.rows.length) {
    telemetry = await pool.query(`
      select username, payload, created_at
      from telemetry
      where kind = 'collector_rows'
      order by id desc
      limit $1
    `, [telemetryEventLimit]);
    telemetryScope = telemetry.rows.length ? "ultima_coleta" : "vazio";
  }
  const recentHours = requestedHours || telemetry.rows
    .map(item => normalizeScannerHours(item.payload?.hours))
    .find(Boolean) || telemetry.rows
    .flatMap(item => Array.isArray(item.payload?.rows) ? item.payload.rows : [])
    .map(row => normalizeScannerHours(row?.hours))
    .find(Boolean) || "Horas3";

  const activeHours = recentHours;
  // A API do BBTips bloqueia consultas feitas pelo Render. A extensao coleta
  // dentro da sessao autenticada e envia as linhas completas para este endpoint.
  const finalApiData = { at: Date.now(), rows: [], errors: [] };
  const apiFutureOddsByKey = new Map();
  for (const row of finalApiData.rows) {
    const rowHours = normalizeScannerHours(row.hours) || activeHours;
    if (rowHours !== activeHours || !row.future || row.score || !scannerHasAnyOdd(row)) continue;
    apiFutureOddsByKey.set(scannerFutureOddsKey(row, row.liga), row);
  }
  const latestFutureMsByLiga = new Map();
  for (const item of telemetry.rows) {
    const payload = item.payload || {};
    const payloadRows = Array.isArray(payload.rows) ? payload.rows : [];
    const payloadPlatform = String(payload.platform || "").toUpperCase();
    const rawPayloadHours = payload.hours === undefined || payload.hours === null ? "" : String(payload.hours);
    const payloadHours = normalizeScannerHours(payload.hours) || null;
    if (rawPayloadHours && !payloadHours) continue;
    if (payloadHours && payloadHours !== activeHours) continue;
    const ligaCounts = new Map();
    for (const payloadRow of payloadRows) {
      const ligaValue = Number(payloadRow?.liga);
      if (Number.isFinite(ligaValue) && ligaValue > 0) {
        ligaCounts.set(ligaValue, (ligaCounts.get(ligaValue) || 0) + 1);
      }
    }
    const majorityLiga = [...ligaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const payloadLiga = Number(payload.liga) || majorityLiga;
    for (const row of payloadRows) {
      if (!row || typeof row !== "object" || row.score || !row.future) continue;
      const fixedRow = scannerLooksLikeOddTime(row) ? null : row;
      if (!fixedRow) continue;
      if (!scannerVisibleFutureSource(fixedRow)) continue;
      if (scannerParseTime(fixedRow.time) === null) continue;
      if (!scannerIsNearCollectionTime(fixedRow.time, item.created_at)) continue;
      if (!scannerIsFutureTime(fixedRow.time)) continue;
      const rowPlatform = String(fixedRow.platform || payloadPlatform || "").toUpperCase();
      const rawRowHoursValue = fixedRow.hours === undefined || fixedRow.hours === null ? "" : String(fixedRow.hours);
      const rawRowHours = normalizeScannerHours(fixedRow.hours);
      if (rawRowHoursValue && !rawRowHours) continue;
      const rowHours = rawRowHours || payloadHours || (requestedHours ? null : activeHours);
      if (rowPlatform && rowPlatform !== platform) continue;
      if (rowHours !== activeHours) continue;
      const resolvedLiga = Number(fixedRow.liga) || payloadLiga;
      if (!resolvedLiga || latestFutureMsByLiga.has(resolvedLiga)) continue;
      latestFutureMsByLiga.set(resolvedLiga, new Date(item.created_at).getTime());
    }
  }

  const seen = new Set();
  const out = [];
  for (const row of finalApiData.rows) {
    const rowHours = normalizeScannerHours(row.hours) || activeHours;
    if (rowHours !== activeHours) continue;
    if (row.future && !row.score) continue;
    const key = scannerCanonicalKey(row, row.liga, row.platform);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, source: "api" });
  }
  for (const item of telemetry.rows) {
    const payload = item.payload || {};
    const payloadRows = Array.isArray(payload.rows) ? payload.rows : [];
    const payloadPlatform = String(payload.platform || "").toUpperCase();
    const rawPayloadHours = payload.hours === undefined || payload.hours === null ? "" : String(payload.hours);
    const payloadHours = normalizeScannerHours(payload.hours) || null;
    if (rawPayloadHours && !payloadHours) continue;
    if (payloadHours && payloadHours !== activeHours) continue;
    const ligaCounts = new Map();
    for (const payloadRow of payloadRows) {
      const ligaValue = Number(payloadRow?.liga);
      if (Number.isFinite(ligaValue) && ligaValue > 0) {
        ligaCounts.set(ligaValue, (ligaCounts.get(ligaValue) || 0) + 1);
      }
    }
    const majorityLiga = [...ligaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const payloadLiga = Number(payload.liga) || majorityLiga;
    for (const row of payloadRows) {
      if (!row || typeof row !== "object") continue;
      if (String(row.api || "") === "result-cache") continue;
      const fixedRow = row.future && !row.score && scannerLooksLikeOddTime(row) ? null : row;
      if (!fixedRow) continue;
      const rowPlatform = String(fixedRow.platform || payloadPlatform || "").toUpperCase();
      if (rowPlatform && rowPlatform !== platform) continue;
      const rawRowHoursValue = fixedRow.hours === undefined || fixedRow.hours === null ? "" : String(fixedRow.hours);
      const rawRowHours = normalizeScannerHours(fixedRow.hours);
      if (rawRowHoursValue && !rawRowHours) continue;
      const rowHours = rawRowHours || payloadHours || (requestedHours ? null : activeHours);
      if (!rowHours || rowHours !== activeHours) continue;
      const resolvedLiga = Number(fixedRow.liga) || (!fixedRow.score && fixedRow.future ? payloadLiga : null);
      if (!resolvedLiga) continue;
      if (fixedRow.future && !fixedRow.score) {
        if (!scannerVisibleFutureSource(fixedRow)) continue;
        if (scannerParseTime(fixedRow.time) === null) continue;
        if (!scannerIsNearCollectionTime(fixedRow.time, item.created_at)) continue;
        if (!scannerIsFutureTime(fixedRow.time)) continue;
        const latestFutureMs = latestFutureMsByLiga.get(resolvedLiga);
        if (!latestFutureMs || new Date(item.created_at).getTime() !== latestFutureMs) continue;
      }
      let nextRow = fixedRow;
      if (fixedRow.future && !fixedRow.score) {
        const apiOddsRow = apiFutureOddsByKey.get(scannerFutureOddsKey(fixedRow, resolvedLiga));
        const mergedOdds = scannerMergeOdds(fixedRow, apiOddsRow);
        nextRow = { ...fixedRow, odds: mergedOdds, oddsSource: apiOddsRow ? "screen+api-odds" : "screen" };
        if (!scannerHasAnyOdd(nextRow)) continue;
      }
      const key = scannerCanonicalKey(nextRow, resolvedLiga, rowPlatform);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ...nextRow,
        liga: resolvedLiga,
        platform: rowPlatform || null,
        hours: rowHours,
        source: "collector",
        collectedAt: item.created_at,
        username: item.username
      });
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }

  res.json({
    ok: true,
    username,
    platform,
    count: out.length,
    rows: out,
    lastEventAt: telemetry.rows[0]?.created_at || null,
    telemetryScope,
    hours: activeHours,
    apiFetchedAt: new Date(finalApiData.at).toISOString(),
    apiErrors: finalApiData.errors
  });
});

app.get("/api/admin/telemetry", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
  const rows = await pool.query(`
    select id, username, kind, payload, created_at
    from telemetry
    order by id desc
    limit $1
  `, [limit]);
  res.json({ ok: true, rows: rows.rows });
});

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body || {};
  const found = await pool.query("select * from admins where username=$1", [username]);
  const admin = found.rows[0];
  if (!admin || !(await bcrypt.compare(password || "", admin.password_hash))) {
    return res.status(401).json({ ok: false, error: "login invalido" });
  }
  res.json({ ok: true, token: tokenFor({ type: "admin", username }) });
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const rows = await pool.query(`
    select id, username, active, expires_at, note, created_at
    from users
    order by id desc
  `);
  res.json({ ok: true, users: rows.rows });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { username, password, active = true, expiresAt = null, note = "" } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "usuario e senha obrigatorios" });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(`
    insert into users (username, password_hash, active, expires_at, note)
    values ($1, $2, $3, $4, $5)
    on conflict (username) do update set
      password_hash = excluded.password_hash,
      active = excluded.active,
      expires_at = excluded.expires_at,
      note = excluded.note
    returning id, username, active, expires_at, note, created_at
  `, [username, hash, Boolean(active), endOfBrazilDay(expiresAt), note]);
  res.json({ ok: true, user: result.rows[0] });
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const { active, expiresAt, note } = req.body || {};
  const result = await pool.query(`
    update users
    set active = coalesce($1, active),
        expires_at = $2,
        note = coalesce($3, note)
    where id = $4
    returning id, username, active, expires_at, note, created_at
  `, [active === undefined ? null : Boolean(active), endOfBrazilDay(expiresAt), note ?? null, req.params.id]);
  res.json({ ok: true, user: result.rows[0] });
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  await pool.query("delete from users where id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const found = await pool.query("select * from users where lower(username)=lower($1)", [username]);
  const user = found.rows[0];
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ ok: false, error: "login invalido" });
  }
  if (!user.active) {
    return res.status(403).json({ ok: false, error: "usuario bloqueado" });
  }
  if (user.expires_at && endOfBrazilDay(user.expires_at).getTime() < Date.now()) {
    return res.status(403).json({ ok: false, error: "acesso vencido" });
  }
  res.json({
    ok: true,
    token: tokenFor({ type: "user", username }),
    user: { username: user.username, expiresAt: user.expires_at }
  });
});

app.post("/api/check", async (req, res) => {
  const token = req.body?.token || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = readToken(String(token || ""));
  if (!payload || !["user", "admin"].includes(payload.type)) {
    return res.status(401).json({ ok: false, active: false, error: "token invalido" });
  }
  if (payload.type === "admin") {
    return res.json({ ok: true, active: true, username: payload.username, type: "admin" });
  }
  const found = await pool.query("select username, active, expires_at from users where username=$1", [payload.username]);
  const user = found.rows[0];
  const active = Boolean(user?.active) && (!user.expires_at || endOfBrazilDay(user.expires_at).getTime() >= Date.now());
  res.json({ ok: true, active, username: payload.username, type: "user" });
});

initDb()
  .then(() => app.listen(port, () => console.log(`BBTips server on ${port}`)))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
