/* ============================================================
   INGEST v2 - ESM - autossuficiente
   Funciona com Postgres (se DATABASE_URL existir) ou sem ele.
   Nao depende de nenhum outro arquivo do projeto.

   No src/server.js, adicione:
     import { montarIngest } from './ingest.js';
     await montarIngest(app);
   ============================================================ */

import fs from 'fs';
import path from 'path';

const ARQUIVO = process.env.JOGOS_PATH || path.join(process.cwd(), 'jogos.json');
const ORIGENS = ['https://thtips.com.br', 'https://www.thtips.com.br'];

let pool = null;          // conexao Postgres, se houver
let memoria = {};         // fallback: { "liga:id": jogo }
let sujo = false;

/* ---------- Postgres (opcional) ---------- */
async function tentarBanco() {
  if (!process.env.DATABASE_URL) {
    console.log('[INGEST] sem DATABASE_URL - usando arquivo/memoria');
    return false;
  }
  try {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,                                   // pool pequeno, nao briga com o resto
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jogos_thtips (
        liga           TEXT NOT NULL,
        id             BIGINT NOT NULL,
        horario        TEXT,
        data_insercao  TIMESTAMP,
        time_a         TEXT,
        time_b         TEXT,
        ft             TEXT,
        gols           INT,
        gols_a         INT,
        gols_b         INT,
        ht             TEXT,
        ht_gols        INT,
        payload        JSONB,
        criado_em      TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (liga, id)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_jogos_thtips_data
       ON jogos_thtips (liga, data_insercao DESC);`
    );
    console.log('[INGEST] Postgres conectado - tabela jogos_thtips pronta');
    return true;
  } catch (e) {
    console.error('[INGEST] Postgres falhou, caindo pro arquivo:', e.message);
    pool = null;
    return false;
  }
}

/* ---------- Arquivo (fallback) ---------- */
function carregarArquivo() {
  try {
    if (fs.existsSync(ARQUIVO)) {
      memoria = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) || {};
      console.log(`[INGEST] arquivo carregado: ${Object.keys(memoria).length} jogos`);
    }
  } catch (e) {
    console.error('[INGEST] arquivo corrompido, comecando vazio:', e.message);
    memoria = {};
  }
}

function salvarArquivo() {
  if (!sujo || pool) return;
  try {
    const tmp = `${ARQUIVO}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(memoria), 'utf8');
    fs.renameSync(tmp, ARQUIVO);
    sujo = false;
  } catch (e) {
    console.error('[INGEST] falha ao salvar:', e.message);
  }
}

/* ---------- Gravacao ---------- */
async function gravar(jogos) {
  let novos = 0, ignorados = 0;

  if (pool) {
    for (const j of jogos) {
      if (!j || j.id == null || j.liga == null) { ignorados++; continue; }
      try {
        const r = await pool.query(
          `INSERT INTO jogos_thtips
             (liga, id, horario, data_insercao, time_a, time_b,
              ft, gols, gols_a, gols_b, ht, ht_gols, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (liga, id) DO UPDATE
             SET ft      = EXCLUDED.ft,
                 gols    = EXCLUDED.gols,
                 gols_a  = EXCLUDED.gols_a,
                 gols_b  = EXCLUDED.gols_b,
                 ht      = EXCLUDED.ht,
                 ht_gols = EXCLUDED.ht_gols,
                 payload = EXCLUDED.payload
             WHERE jogos_thtips.ft IS NULL
           RETURNING (xmax = 0) AS inserido;`,
          [String(j.liga), j.id, j.horario ?? null, j.dataInsercao || null,
           j.timeA ?? null, j.timeB ?? null, j.ft ?? null, j.gols ?? null,
           j.golsA ?? null, j.golsB ?? null, j.ht ?? null, j.htGols ?? null,
           JSON.stringify(j)]
        );
        if (r.rows[0]?.inserido) novos++; else ignorados++;
      } catch (e) {
        console.error('[INGEST] erro no insert:', e.message);
        ignorados++;
      }
    }
  } else {
    for (const j of jogos) {
      if (!j || j.id == null || j.liga == null) { ignorados++; continue; }
      const k = `${j.liga}:${j.id}`;
      if (!memoria[k]) { memoria[k] = j; novos++; }
      else if (memoria[k].ft == null && j.ft != null) { memoria[k] = j; novos++; }
      else ignorados++;
    }
    if (novos) { sujo = true; salvarArquivo(); }
  }

  return { novos, ignorados };
}

/* ---------- Leitura ---------- */
async function ler(liga, limite) {
  if (pool) {
    const r = await pool.query(
      `SELECT payload FROM jogos_thtips
        WHERE liga = $1
        ORDER BY data_insercao DESC NULLS LAST, id DESC
        LIMIT $2;`,
      [String(liga), limite]
    );
    return r.rows.map(x => x.payload).reverse();
  }
  return Object.values(memoria)
    .filter(j => String(j.liga) === String(liga))
    .sort((a, b) => (a.id || 0) - (b.id || 0))
    .slice(-limite);
}

async function contar() {
  if (pool) {
    const r = await pool.query(
      `SELECT liga, COUNT(*)::int AS total, MAX(data_insercao) AS ultimo
         FROM jogos_thtips GROUP BY liga;`
    );
    return Object.fromEntries(
      r.rows.map(x => [x.liga, { total: x.total, ultimo: x.ultimo }])
    );
  }
  const out = {};
  for (const j of Object.values(memoria)) {
    const l = String(j.liga);
    if (!out[l]) out[l] = { total: 0, ultimo: null };
    out[l].total++;
    if (j.dataInsercao && (!out[l].ultimo || j.dataInsercao > out[l].ultimo)) {
      out[l].ultimo = j.dataInsercao;
    }
  }
  return out;
}

/* ---------- Rotas ---------- */
export async function montarIngest(app, opcoes = {}) {
  const CODIGO = opcoes.codigo || process.env.CODIGO_INGEST || null;

  const temBanco = await tentarBanco();
  if (!temBanco) carregarArquivo();

  // CORS proprio da rota - inclui o preflight OPTIONS.
  // Sem ele, o POST da sonda morre calado.
  app.use('/ingest', (req, res, next) => {
    const origem = req.headers.origin;
    if (origem && ORIGENS.includes(origem)) {
      res.setHeader('Access-Control-Allow-Origin', origem);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.post('/ingest', async (req, res) => {
    try {
      const corpo = req.body || {};
      if (CODIGO && corpo.codigo !== CODIGO) {
        return res.status(401).json({ erro: 'codigo invalido' });
      }
      if (!Array.isArray(corpo.jogos)) {
        return res.status(400).json({ erro: 'campo "jogos" precisa ser array' });
      }
      const r = await gravar(corpo.jogos);
      res.json({ ok: true, ...r, modo: pool ? 'postgres' : 'arquivo' });
    } catch (e) {
      console.error('[INGEST] erro no POST:', e);
      res.status(500).json({ erro: e.message });
    }
  });

  app.get('/ingest/status', async (req, res) => {
    try {
      res.json({ ok: true, modo: pool ? 'postgres' : 'arquivo', porLiga: await contar() });
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  });

  app.get('/jogos-th', async (req, res) => {
    try {
      const liga = String(req.query.liga || '2');
      const limite = Math.min(parseInt(req.query.limite || '2000', 10), 20000);
      const jogos = await ler(liga, limite);
      res.json({ ok: true, liga, total: jogos.length, jogos });
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  });

  console.log('[INGEST] rotas: POST /ingest | GET /ingest/status | GET /jogos-th');
}
