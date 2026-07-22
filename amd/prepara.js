/* ============================================================
   PREPARA — monta o AMD Live 2 no deploy
   Baixa o codigo do AMD Live original (repo publico caramelo-live)
   e aplica as adaptacoes para ler os dados do thtips.

   Roda sozinho no "npm install" do Render (postinstall).
   ============================================================ */
import fs from "fs";
import path from "path";

const RAW = "https://raw.githubusercontent.com/maurinhupimenta-cell/caramelo-live/main/";
const AQUI = path.dirname(new URL(import.meta.url).pathname);

const ARQUIVOS = [
  "server.js",
  "public/index.html",
  "public/sw.js",
  "brain/adapter.cjs",
  "brain/loader.cjs",
  "brain/shim.cjs",
  "brain/robot-original.js",
];

async function baixar(rel) {
  const r = await fetch(RAW + rel);
  if (!r.ok) throw new Error(rel + " HTTP " + r.status);
  const txt = await r.text();
  const destino = path.join(AQUI, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, txt, "utf8");
  return txt;
}

/* ---------- patch do servidor ---------- */
function adaptarServidor(s) {
  const antigo =
    'const LIGAS = ["euro", "copa", "super", "premier"];\n' +
    'const BASE = "https://www.caramelotips.com.br/final/";';
  if (!s.includes(antigo)) throw new Error("bloco LIGAS/BASE nao encontrado (o AMD original mudou?)");

  const novo = `// ---- FONTE: banco do thtips (bbtips-server) ----
const TH_API = process.env.TH_API || "https://bbtips-server.onrender.com";
let LIGAS = ["betano-1"];
const LIGA_ROTULO = {};
const BASE = "https://www.caramelotips.com.br/final/";

function partesLiga(id) {
  const m = String(id).match(/^([a-z0-9]+)-(\\d+)$/i);
  return m ? { casa: m[1], liga: m[2] } : { casa: "betano", liga: "1" };
}

async function descobrirLigas() {
  try {
    const r = await fetch(TH_API + "/casas", { cache: "no-store" });
    const j = await r.json();
    const itens = (j.itens || []).filter(x => Number(x.total) >= 20);
    if (!itens.length) return;
    const ids = [];
    for (const it of itens) {
      const id = String(it.casa).toLowerCase() + "-" + it.liga;
      ids.push(id);
      LIGA_ROTULO[id] = String(it.casa).charAt(0).toUpperCase() + String(it.casa).slice(1) + " \\u00b7 Liga " + it.liga;
    }
    ids.sort();
    LIGAS = ids;
    console.log("[AMD-TH] ligas descobertas:", LIGAS.join(", "));
  } catch (e) {
    console.error("[AMD-TH] nao consegui descobrir as ligas:", e.message);
  }
}

function jogosParaGames(lista) {
  const games = [], upcoming = [];
  for (const j of lista) {
    const casa = j.timeA || j.siglaA || "?";
    const fora = j.timeB || j.siglaB || "?";
    const horario = j.horario || "";
    if (j.golsA == null || j.golsB == null) {
      upcoming.push({ nome: casa + " x " + fora, casa, fora, horario, odds: {} });
      continue;
    }
    const a = Number(j.golsA), b = Number(j.golsB);
    games.push({
      nome: casa + " x " + fora, casa, fora, horario,
      a, b, total: a + b, placar: a + "-" + b, odds: {}
    });
  }
  return { games, upcoming };
}`;
  s = s.replace(antigo, novo);

  // refreshLiga passa a ler do nosso banco
  const ini = s.indexOf("async function refreshLiga(liga) {");
  if (ini < 0) throw new Error("refreshLiga nao encontrada");
  const marca = s.indexOf("if (!store[liga]) store[liga] = { erro: e.message", ini);
  const fim = s.indexOf("\n}", marca) + 2;
  const nova = `async function refreshLiga(liga) {
  try {
    const { casa, liga: num } = partesLiga(liga);
    const url = TH_API + "/jogos-th?casa=" + encodeURIComponent(casa) + "&liga=" + encodeURIComponent(num) + "&limite=2000";
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const lista = Array.isArray(j.jogos) ? j.jogos : [];
    if (!lista.length) throw new Error("zero jogos");
    const { games, upcoming } = jogosParaGames(lista);
    if (!games.length) throw new Error("zero placares");
    const s2 = buildStore(liga, games, upcoming, new Date().toISOString());
    s2.fonte = "thtips";
    store[liga] = s2;
  } catch (e) {
    if (!store[liga]) store[liga] = { erro: e.message, fetchedAt: new Date().toISOString() };
  }
}
`;
  s = s.slice(0, ini) + nova + s.slice(fim);

  // desliga o WebSocket do caramelo
  s = s.replace("const WS_SERVER_ENABLED", "const WS_SERVER_ENABLED_ORIG");
  s = s.replace("WS_SERVER_ENABLED_ORIG =", "WS_SERVER_ENABLED = false; const WS_SERVER_ENABLED_ORIG =", 1);

  // descobre as ligas antes do primeiro ciclo
  s = s.replace(
    "await Promise.all(LIGAS.map(refreshLiga));",
    "await descobrirLigas();\n  await Promise.all(LIGAS.map(refreshLiga));",
    1
  );

  // rota que lista as ligas para a interface
  const anc = 'app.get("/api/status", (req, res) => {';
  s = s.replace(anc, `app.get("/api/ligas", (req, res) => {
  res.json(LIGAS.map(l => ({ id: l, rotulo: LIGA_ROTULO[l] || l })));
});

${anc}`, 1);

  s = s.replace("AMD Live rodando na porta", "AMD Live 2 (thtips) rodando na porta");
  return s;
}

/* ---------- patch da interface ---------- */
function adaptarInterface(h) {
  const velho = '<select id="liga"><option value="euro">Euro</option><option value="copa">Copa</option><option value="super">Super</option><option value="premier">Premier</option></select>';
  if (!h.includes(velho)) throw new Error("seletor de ligas nao encontrado");
  h = h.replace(velho, '<select id="liga"></select>');

  const carregador = `<script>
(async function(){
  try{
    const r = await fetch('/api/ligas', {cache:'no-store'});
    const ls = await r.json();
    const sel = document.getElementById('liga');
    if (Array.isArray(ls) && ls.length){
      sel.innerHTML = ls.map(l => '<option value="'+l.id+'">'+l.rotulo+'</option>').join('');
      const salva = localStorage.getItem('amd_liga');
      if (salva && ls.some(l=>l.id===salva)) sel.value = salva;
      sel.addEventListener('change', ()=>localStorage.setItem('amd_liga', sel.value));
      sel.dispatchEvent(new Event('change'));
    } else {
      sel.innerHTML = '<option value="">sem dados ainda</option>';
    }
  }catch(e){
    document.getElementById('liga').innerHTML = '<option value="">erro ao listar ligas</option>';
  }
})();
</script>
</body>`;
  h = h.replace("</body>", carregador, 1);
  h = h.replace("<title>AMD Live", "<title>AMD Live 2");
  return h;
}

/* ---------- execucao ---------- */
(async () => {
  try {
    console.log("[PREPARA] baixando o AMD Live original...");
    for (const rel of ARQUIVOS) {
      const txt = await baixar(rel);
      console.log("  ok " + rel + " (" + txt.length + " bytes)");
    }

    console.log("[PREPARA] adaptando para o thtips...");
    const srv = fs.readFileSync(path.join(AQUI, "server.js"), "utf8");
    fs.writeFileSync(path.join(AQUI, "server.js"), adaptarServidor(srv), "utf8");

    const idx = fs.readFileSync(path.join(AQUI, "public/index.html"), "utf8");
    fs.writeFileSync(path.join(AQUI, "public/index.html"), adaptarInterface(idx), "utf8");

    console.log("[PREPARA] pronto. AMD Live 2 montado.");
  } catch (e) {
    console.error("[PREPARA] FALHOU:", e.message);
    process.exit(1);
  }
})();
