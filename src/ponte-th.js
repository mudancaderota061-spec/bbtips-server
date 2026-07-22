/* ============================================================
   PONTE TH -> virtual.html
   Serve os jogos do thtips no formato que a tela virtual.html
   ja entende, SEM alterar a tela.

   A tela chama /api/scanner-data?platform=BETANO&hours=Horas12
   Esta ponte intercepta essa rota ANTES da original e responde
   com os dados da tabela jogos_th.

   No src/server.js, logo depois de "await montarIngest(app);":
     import { montarPonteTh } from './ponte-th.js';
     montarPonteTh(app);

   IMPORTANTE: tem que vir ANTES da rota /api/scanner-data original.
   Como montarIngest ja roda cedo, adicione a linha logo apos ela.
   ============================================================ */

import path from 'path';
import { fileURLToPath } from 'url';

// mapeia o nome que a tela usa -> a casa que a sonda gravou
const CASA_PARA_TH = {
  BET365: 'bet365',
  BETANO: 'betano',
  BRBET: 'kiron',        // na tela o botao "Kiron" tem value BRBET
  KIRON: 'kiron',
  SPORTINGBET: 'sportingbet',
};

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
  return pool;
}

// traduz uma linha do banco para o formato da tela
function paraLinha(j, plataforma) {
  return {
    name: `${j.timeA ?? j.siglaA ?? '?'} x ${j.timeB ?? j.siglaB ?? '?'}`,
    score: j.ft || null,          // "1-3" ou null (jogo futuro)
    resultado: j.ft || null,
    liga: Number(j.liga) || 1,
    horario: j.horario || null,
    time: j.horario || null,
    platform: plataforma,
    hours: 'Horas12',
    future: !j.ft,                // sem placar = futuro
    ht: j.ht || null,
    source: 'thtips',
  };
}

export function montarPonteTh(app) {
  // intercepta ANTES da rota original de scanner-data
  app.get('/api/scanner-data', async (req, res, next) => {
    try {
      const p = await garantirPool();
      if (!p) return next();     // sem banco: deixa a rota original responder

      const nome = String(req.query.platform || 'BETANO').toUpperCase();
      const casa = CASA_PARA_TH[nome];
      if (!casa) return next();  // plataforma que nao e do thtips: rota original

      const limite = Math.max(1, Math.min(5000, Number(req.query.limit) || 3000));

      const r = await p.query(
        `SELECT payload FROM jogos_th
          WHERE casa = $1
          ORDER BY liga ASC, data_insercao DESC NULLS LAST, id DESC
          LIMIT $2;`,
        [casa, limite]
      );

      // se nao tem dado dessa casa ainda, deixa a rota original tentar
      if (!r.rows.length) return next();

      const rows = r.rows
        .map(x => x.payload)
        .filter(Boolean)
        .map(j => paraLinha(j, nome));

      res.json({
        ok: true,
        username: 'th',
        platform: nome,
        count: rows.length,
        rows,
        lastEventAt: new Date().toISOString(),
        telemetryScope: 'thtips',
        hours: 'Horas12',
        apiFetchedAt: new Date().toISOString(),
        apiErrors: [],
      });
    } catch (e) {
      console.error('[PONTE-TH] erro:', e.message);
      next();  // qualquer falha: cai na rota original
    }
  });

  console.log('[PONTE-TH] /api/scanner-data servindo dados do thtips');
}
