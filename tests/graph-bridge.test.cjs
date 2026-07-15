const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("background.js", "utf8");
let listener = null;
let fetchCount = 0;
let fetchedUrl = "";
const rows = [{ c: [{ v: "1" }, { v: "Casa x Fora2-1\n0-0 o25@2.20\n01" }] }];

const context = {
  chrome: {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    }
  },
  fetch: async (url) => {
    fetchCount += 1;
    fetchedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ table: { rows } })
    };
  },
  Date,
  Error,
  Map,
  Number,
  String
};

vm.createContext(context);
vm.runInContext(source, context);
assert.equal(typeof listener, "function", "service worker precisa registrar o receptor");

function request(liga) {
  return new Promise((resolve) => {
    const asyncResponse = listener({ type: "BBTIPS_FETCH_GRAPH_DATA", liga }, {}, resolve);
    assert.equal(asyncResponse, true, "resposta precisa permanecer aberta durante o fetch");
  });
}

(async () => {
  const first = await request(1);
  assert.equal(first.ok, true);
  assert.equal(first.json.table.rows.length, 1);
  assert.match(fetchedUrl, /\/final\/copa\.json$/);
  assert.equal(fetchCount, 1);

  const cached = await request(1);
  assert.equal(cached.ok, true);
  assert.equal(fetchCount, 1, "segunda leitura em 15 segundos deve usar cache");

  const invalid = await request(6);
  assert.equal(invalid.ok, false, "Bet365 nao deve buscar liga 6");

  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const contentSource = fs.readFileSync("content.js", "utf8");
  assert.equal(manifest.background?.service_worker, "background.js");
  assert.ok(manifest.host_permissions.some((value) => value.includes("caramelotips.com.br")));
  assert.match(contentSource, /chrome\.runtime\.getURL\("robot\.js"\)/, "leitor precisa vir do pacote instalado");
  assert.doesNotMatch(contentSource, /\/api\/robo\.js/, "servidor nao pode substituir o leitor local");
  console.log("graph-bridge: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
