/* ============================================================
   CHAVES DE ACESSO  -  igual ao AMD Live
   Voce gera uma chave (ex: TH-4K9M-2XQP), manda pro amigo,
   ele cola numa tela e entra. Sem cadastro.

   Gera um token compativel com o readToken() do server.js
   (mesmo JWT_SECRET), entao a virtual.html funciona sem mudar.

   No src/server.js, depois de montarIngest e montarPonteTh:
     import { montarChaves } from './chaves.js';
     await montarChaves(app);

   Rotas:
     POST /api/th/entrar        { chave }  -> devolve token
     POST /api/th/gerar         (admin)    -> cria chave nova
     GET  /api/th/listar        (admin)    -> lista chaves
     POST /api/th/revogar       (admin)    -> desativa uma chave
   ============================================================ */

import crypto from 'node:crypto';

const JWT = process.env.JWT_SECRET || 'troque-essa-chave';
// senha de admin do painel de chaves (separada do admin antigo)
const ADMIN_CHAVES = process.env.ADMIN_CHAVES || 'th-admin-2026';

let pool = null;

async function garantirPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  const { default: pg } = await import('pg');
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chaves_th (
      chave        TEXT PRIMARY KEY,
      dono         TEXT,
      ativa        BOOLEAN DEFAULT TRUE,
      validade     TIMESTAMP,
      criada_em    TIMESTAMP DEFAULT NOW(),
      ultimo_uso   TIMESTAMP,
      usos         INT DEFAULT 0
    );
  `);
  return pool;
}

// gera token no MESMO formato do server.js (readToken vai aceitar)
function tokenPara(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,   // 7 dias
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function novaChave() {
  const bloco = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TH-${bloco()}-${bloco()}`;
}

const ehAdmin = (req) =>
  (req.headers['x-admin'] || req.body?.admin || req.query.admin) === ADMIN_CHAVES;

export async function montarChaves(app) {
  const p = await garantirPool();
  if (!p) {
    console.log('[CHAVES] sem DATABASE_URL - chaves desabilitadas');
    return;
  }

  // ---- entrar com a chave (aberto) ----
  app.post('/api/th/entrar', async (req, res) => {
    try {
      const chave = String(req.body?.chave || '').trim().toUpperCase();
      if (!chave) return res.status(400).json({ ok: false, error: 'informe a chave' });

      const r = await p.query('SELECT * FROM chaves_th WHERE chave = $1', [chave]);
      const linha = r.rows[0];
      if (!linha)        return res.status(401).json({ ok: false, error: 'chave nao encontrada' });
      if (!linha.ativa)  return res.status(403).json({ ok: false, error: 'chave revogada' });
      if (linha.validade && new Date(linha.validade) < new Date()) {
        return res.status(403).json({ ok: false, error: 'chave expirada' });
      }

      await p.query(
        'UPDATE chaves_th SET ultimo_uso = NOW(), usos = usos + 1 WHERE chave = $1',
        [chave]
      );

      // type "user" para o readToken/requireUserOrAdmin aceitar
      const token = tokenPara({ type: 'user', username: linha.dono || chave });
      res.json({ ok: true, token, dono: linha.dono || null });
    } catch (e) {
      console.error('[CHAVES] entrar:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- gerar chave (admin) ----
  app.post('/api/th/gerar', async (req, res) => {
    if (!ehAdmin(req)) return res.status(401).json({ ok: false, error: 'admin invalido' });
    try {
      const dono = String(req.body?.dono || '').trim() || null;
      const dias = Number(req.body?.dias) || 0;   // 0 = sem validade
      const validade = dias > 0 ? new Date(Date.now() + dias * 864e5) : null;

      let chave, tentativas = 0;
      do { chave = novaChave(); tentativas++; }
      while ((await p.query('SELECT 1 FROM chaves_th WHERE chave=$1', [chave])).rows.length && tentativas < 5);

      await p.query(
        'INSERT INTO chaves_th (chave, dono, validade) VALUES ($1, $2, $3)',
        [chave, dono, validade]
      );
      res.json({ ok: true, chave, dono, validade });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- listar (admin) ----
  app.get('/api/th/listar', async (req, res) => {
    if (!ehAdmin(req)) return res.status(401).json({ ok: false, error: 'admin invalido' });
    try {
      const r = await p.query('SELECT * FROM chaves_th ORDER BY criada_em DESC');
      res.json({ ok: true, chaves: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- revogar / reativar (admin) ----
  app.post('/api/th/revogar', async (req, res) => {
    if (!ehAdmin(req)) return res.status(401).json({ ok: false, error: 'admin invalido' });
    try {
      const chave = String(req.body?.chave || '').trim().toUpperCase();
      const ativa = req.body?.ativa === true;   // manda ativa:true pra reativar
      const r = await p.query(
        'UPDATE chaves_th SET ativa = $2 WHERE chave = $1 RETURNING *',
        [chave, ativa]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'chave nao existe' });
      res.json({ ok: true, chave: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[CHAVES] rotas: /api/th/entrar | /gerar | /listar | /revogar');
}
