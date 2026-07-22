/* ============================================================
   SONDA THTIPS - content script da extensao BBTips Robo
   Roda automaticamente em thtips.com.br.
   Coleta os jogos e envia para o mirror no Render.

   Controles no console da pagina:
     __sondaTh.status()  __sondaTh.parar()  __sondaTh.forcar()
   ============================================================ */
(() => {
  'use strict';

  // so roda no thtips - a extensao tambem injeta em bbtips/caramelotips
  if (!/(^|\.)thtips\.com\.br$/i.test(location.hostname)) return;
  if (window.__sondaTh) return;

  const MIRROR   = 'https://bbtips-server.onrender.com/ingest';
  const CODIGO   = 'caramelo-th-2026';   // precisa bater com CODIGO_INGEST no Render
  const BASE     = 'https://api.thtips.com.br/api/futebolvirtual';
  const LIGAS    = [2];
  const POLL_MS  = 8000;                 // limite deles e 20 req/s - folgado
  const JANELA   = 'Horas12';
  const FILA_KEY = 'sondaTh_fila';
  const FILA_MAX = 3000;

  let timer = null, rodando = true;
  const ultimaAt = {};
  const vistos = {};

  const log = (...a) => console.log('%c[SONDA]', 'color:#0af;font-weight:bold', ...a);
  const err = (...a) => console.error('%c[SONDA]', 'color:#f44;font-weight:bold', ...a);

  const urlHeartbeat = (l) => `${BASE}/ultimaAtualizacao?liga=${l}`;
  const urlJogos = (l) =>
    `${BASE}?liga=${l}&futuro=false&Horas=${JANELA}` +
    `&tipoOdd=&dadosAlteracao=&filtros=&confrontos=false&hrsConfrontos=240`;

  /* ---------- Parser ---------- */
  function parsePlacar(txt) {
    if (typeof txt !== 'string') return null;
    const m = txt.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) return null;                    // cobre "OUT", "-", vazio
    const a = +m[1], b = +m[2];
    return { a, b, total: a + b };
  }

  function normalizar(j, liga) {
    const ft = parsePlacar(j.Resultado_FT ?? j.Resultado);
    const ht = parsePlacar(j.Resultado_HT);
    return {
      id: j.Id, liga,
      horario: j.Horario ?? null,
      dataInsercao: j.DataInsercao ?? null,
      siglaA: j.SiglaA ?? null, siglaB: j.SiglaB ?? null,
      timeA: j.TimeA ?? null,   timeB: j.TimeB ?? null,
      ft: ft ? `${ft.a}-${ft.b}` : null,
      golsA: ft ? ft.a : null, golsB: ft ? ft.b : null, gols: ft ? ft.total : null,
      ht: ht ? `${ht.a}-${ht.b}` : null,
      htGolsA: ht ? ht.a : null, htGolsB: ht ? ht.b : null, htGols: ht ? ht.total : null,
      mercados: {
        o05: ft ? ft.total > 0.5 : null,
        o15: ft ? ft.total > 1.5 : null,
        o25: ft ? ft.total > 2.5 : null,
        o35: ft ? ft.total > 3.5 : null,
        o45: ft ? ft.total > 4.5 : null,
        btts: ft ? (ft.a > 0 && ft.b > 0) : null,
        htO05: ht ? ht.total > 0.5 : null,
        htO15: ht ? ht.total > 1.5 : null,
      },
      primeiroMarcar: j.PrimeiroMarcar && j.PrimeiroMarcar !== '-' ? j.PrimeiroMarcar : null,
      ultimoMarcar:   j.UltimoMarcar   && j.UltimoMarcar   !== '-' ? j.UltimoMarcar   : null,
      vencedorHtFt: j.Vencedor_HT_FT ?? null,
      oddResultadoHt: j.Resultado_HT_Odd != null ? parseFloat(j.Resultado_HT_Odd) : null,
    };
  }

  function achatar(payload, liga) {
    const linhas = Array.isArray(payload?.Linhas) ? payload.Linhas : [];
    const out = [];
    for (const linha of linhas) {
      const cols = Array.isArray(linha?.Colunas) ? linha.Colunas : [];
      for (const j of cols) if (j && j.Id != null) out.push(normalizar(j, liga));
    }
    return out;
  }

  /* ---------- Fila offline ---------- */
  const lerFila = () => {
    try { return JSON.parse(localStorage.getItem(FILA_KEY) || '[]'); } catch { return []; }
  };
  const gravarFila = (a) => {
    try { localStorage.setItem(FILA_KEY, JSON.stringify(a.slice(-FILA_MAX))); }
    catch (e) { err('fila nao gravou:', e.message); }
  };
  function enfileirar(jogos) {
    const fila = lerFila();
    const ids = new Set(fila.map(j => `${j.liga}:${j.id}`));
    for (const j of jogos) {
      const k = `${j.liga}:${j.id}`;
      if (!ids.has(k)) { fila.push(j); ids.add(k); }
    }
    gravarFila(fila);
    return fila.length;
  }

  /* ---------- Envio ---------- */
  async function enviar(jogos) {
    if (!jogos.length) return true;
    try {
      const r = await fetch(MIRROR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: CODIGO, fonte: 'thtips', jogos }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const resp = await r.json().catch(() => ({}));
      log(`enviados ${jogos.length} | novos no servidor: ${resp.novos ?? '?'}`);
      return true;
    } catch (e) {
      err('envio falhou:', e.message, '- guardando na fila');
      return false;
    }
  }

  async function drenar() {
    const fila = lerFila();
    if (!fila.length) return;
    log(`drenando fila: ${fila.length} pendentes`);
    const lote = fila.slice(0, 500);
    if (await enviar(lote)) gravarFila(fila.slice(lote.length));
  }

  /* ---------- Ciclo ---------- */
  async function ciclo(liga) {
    let stamp;
    try {
      const r = await fetch(urlHeartbeat(liga));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      stamp = (await r.text()).trim();
    } catch (e) { err(`liga ${liga} heartbeat:`, e.message); return; }

    if (stamp === ultimaAt[liga]) return;   // nada mudou
    ultimaAt[liga] = stamp;

    let dados;
    try {
      const r = await fetch(urlJogos(liga));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dados = await r.json();
    } catch (e) {
      err(`liga ${liga} payload:`, e.message);
      ultimaAt[liga] = null;
      return;
    }

    const todos = achatar(dados, liga);
    if (!vistos[liga]) vistos[liga] = new Set();
    const novos = todos.filter(j => !vistos[liga].has(j.id));
    novos.forEach(j => vistos[liga].add(j.id));
    if (!novos.length) return;

    log(`liga ${liga}: ${novos.length} novos (payload tinha ${todos.length})`);
    if (!(await enviar(novos))) log(`fila offline: ${enfileirar(novos)}`);
  }

  async function tick() {
    if (!rodando) return;
    try {
      await drenar();
      for (const l of LIGAS) {
        await ciclo(l);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e) { err('tick:', e); }
    finally { if (rodando) timer = setTimeout(tick, POLL_MS); }
  }

  window.__sondaTh = {
    parar() { rodando = false; if (timer) clearTimeout(timer); log('parada.'); },
    status() {
      return {
        rodando, ligas: LIGAS, ultimaAtualizacao: { ...ultimaAt },
        jogosNaSessao: Object.fromEntries(
          Object.entries(vistos).map(([k, v]) => [k, v.size])
        ),
        filaPendente: lerFila().length,
      };
    },
    forcar() { for (const l of LIGAS) ultimaAt[l] = null; log('proximo ciclo busca tudo.'); },
    limparFila() { gravarFila([]); log('fila limpa.'); },
  };

  log(`iniciada | ligas ${LIGAS.join(',')} | poll ${POLL_MS}ms | mirror ${MIRROR}`);
  setTimeout(tick, 3000);   // deixa a pagina carregar antes
})();
