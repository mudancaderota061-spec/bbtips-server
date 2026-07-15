const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("robo.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `funcao ${name} nao encontrada`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`funcao ${name} incompleta`);
}

const functions = [
  "isCarameloGraphPage",
  "desiredNativeMarket",
  "nativeMarketKey",
  "nativeMarketValue",
  "marketCandidate",
  "selectedControlMarket",
  "activeChipMarket",
  "storedNativeMarket",
  "resolveNativeMarket",
  "nativeMarketPays",
  "nativeMarkerKind",
  "nativeMarkerKindsFromConfig",
  "graphLigaFromSource",
  "activeGraphLiga",
  "requestBridgedGraphData",
  "internalResultsFromLoadedJson",
  "calculateNativeGraphSeries",
  "calculateNativeSeries",
  "readNativeGraphData"
];

const runtimeCode = [
  "let internalResultsCacheSource = null;",
  "let internalResultsCache = [];",
  "let bridgedGraphJson = null;",
  "let bridgedGraphLiga = 0;",
  "let graphBridgePending = false;",
  "let graphBridgeRequestedAt = 0;",
  "let graphBridgeError = '';",
  ...functions.map(extractFunction),
  "function biggestChart() { return null; }",
  "function nativeMacdHistogram(values) { return values.map(() => 0); }",
  "if (window.__testBridgedJson) bridgedGraphJson = window.__testBridgedJson;",
  "result = readNativeGraphData();"
].join("\n");

function resultCell(home, away, htHome = 0, htAway = 0) {
  return { v: `Casa x Fora${home}-${away}\n${htHome}-${htAway} o25@2.20 ambs@2.00\n01` };
}

function rowsFromScores(scores) {
  const rows = [];
  for (let offset = 0; offset < scores.length; offset += 20) {
    const cells = scores.slice(offset, offset + 20).map((score) => resultCell(...score));
    rows.push({ c: [{ v: String(rows.length) }, ...cells.reverse()] });
  }
  return rows;
}

function run({ cfg, points = [], rows = null, bridgedRows = null, selectedMarket = "", scannerMarket = "over25", hostname = "www.caramelotips.com.br", includeGraphElement = true, activeLiga = 1, resourceUrls = [] }) {
  const elements = {
    graficoPrincipalNovoPanel: { querySelectorAll: () => [] },
    linhaFT: { value: selectedMarket },
    qtd: { value: "120" }
  };
  if (includeGraphElement) elements.grafico = { closest: () => null };
  const context = {
    window: {
      __gpLastCfg: cfg,
      __ultimoPontosSelecionado: points,
      LOADED_JSON: rows ? { table: { rows } } : null,
      __testBridgedJson: bridgedRows ? { table: { rows: bridgedRows } } : null,
      BBTipsRobo: { config: { market: scannerMarket }, activeLiga: () => activeLiga },
      postMessage: () => {}
    },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { innerText: "Tendencias Referencia" }
    },
    location: { hostname },
    performance: { getEntriesByType: () => resourceUrls.map((name) => ({ name })) },
    getComputedStyle: () => ({ backgroundColor: "rgb(15, 20, 28)" }),
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    Array,
    Boolean,
    JSON,
    Map,
    Math,
    Number,
    Set,
    String,
    result: null
  };
  vm.createContext(context);
  vm.runInContext(runtimeCode, context);
  return context.result;
}

const scores = Array.from({ length: 60 }, (_, index) => {
  if (index < 20) return [3, 1, 0, 0];
  if (index < 40) return [0, 1, 0, 0];
  return index % 2 ? [2, 1, 0, 0] : [0, 0, 0, 0];
});
const rows = rowsFromScores(scores);
const directPoints = Array.from({ length: 120 }, (_, index) => 20 + index % 10);

const direct = run({
  cfg: { tipoLinha: "over25", pontosSelecionado: directPoints },
  selectedMarket: "over25",
  rows
});
assert.equal(direct.points.length, 120);
assert.match(direct.sourcePath, /__gpLastCfg/);

const directWithColors = run({
  cfg: {
    tipoLinha: "over25",
    pontosSelecionado: [30, 35, 35, 35, ...directPoints.slice(4)],
    datasets: [{
      _tipo: "over25",
      order: 0,
      markerColors: ["rgb(204,204,204)", "rgb(204,204,204)", "#4CAF50", "#FF3B30", ...directPoints.slice(4).map(() => "#4CAF50")]
    }]
  },
  selectedMarket: "over25",
  rows
});
assert.equal(directWithColors.points[1].marker, "white");
assert.equal(directWithColors.points[1].delta, 5);
assert.equal(directWithColors.points[2].marker, "green");
assert.equal(directWithColors.points[2].delta, 0);
assert.equal(directWithColors.points[3].marker, "red");
assert.equal(directWithColors.points[3].delta, 0);

const recalculated = run({
  cfg: { pontosSelecionado: directPoints },
  points: directPoints,
  rows,
  scannerMarket: "over25"
});
assert.equal(recalculated.points.length, 41);
assert.match(recalculated.sourcePath, /CONTAGEM EXATA/);
assert.notEqual(recalculated.points.at(-1).v, 99);

const waiting = run({
  cfg: { pontosSelecionado: directPoints },
  points: directPoints,
  scannerMarket: "over25"
});
assert.equal(waiting.waiting, true);

const parsedFt = recalculated.points.map((point) => point.v);
assert.ok(Math.max(...parsedFt) > Math.min(...parsedFt), "a serie FT nao pode ficar plana pelo HT 0-0");
const recalculatedWhites = recalculated.points.filter((point) => point.marker === "white" && point.delta !== 0);
assert.ok(recalculatedWhites.some((point) => point.delta > 0), "precisa preservar branca de subida");
assert.ok(recalculatedWhites.some((point) => point.delta < 0), "precisa preservar branca de descida");

const thtipsInternal = run({
  cfg: null,
  rows,
  scannerMarket: "over25",
  hostname: "thtips.com.br",
  includeGraphElement: false
});
assert.equal(thtipsInternal.points.length, 41, "THTips deve calcular todos os pontos pelo JSON interno");
assert.match(thtipsInternal.sourcePath, /CONTAGEM EXATA/);

const thtipsBridged = run({
  cfg: null,
  bridgedRows: rows,
  scannerMarket: "over25",
  hostname: "thtips.com.br",
  includeGraphElement: false
});
assert.equal(thtipsBridged.points.length, 41, "ponte da extensao deve tirar o grafico do estado aguardando");
assert.equal(thtipsBridged.points.filter((point) => point.marker === "white" && point.delta !== 0).length > 0, true);

function testActiveGraphLiga({ direct = 0, resources = [], stored = "" }) {
  const context = {
    window: { BBTipsRobo: { activeLiga: () => direct } },
    performance: { getEntriesByType: () => resources.map((name) => ({ name })) },
    sessionStorage: { getItem: () => stored },
    document: { querySelectorAll: () => [] },
    getComputedStyle: () => ({ backgroundColor: "rgb(15, 20, 28)" }),
    Number,
    String,
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("graphLigaFromSource")}\n${extractFunction("activeGraphLiga")}\nresult=activeGraphLiga();`, context);
  return context.result;
}

assert.equal(testActiveGraphLiga({
  direct: 6,
  resources: [
    "https://www.caramelotips.com.br/final/copa.json",
    "https://www.caramelotips.com.br/final/super.json"
  ]
}), 3, "a URL mais recente do JSON deve identificar Super mesmo se a funcao antiga retornar liga 6");
assert.equal(testActiveGraphLiga({ direct: 0, stored: "https://www.caramelotips.com.br/final/premier.json" }), 4);

function testActiveLiga(platform, label) {
  const context = {
    CONFIG: { ligaAuto: true },
    ACTIVE_LIGA_BLOCKED: false,
    currentPlatform: () => platform,
    carameloLigaFromUrl: () => null,
    carameloDatasetUrl: () => "",
    esc: (value) => String(value),
    innerHeight: 900,
    getComputedStyle: () => ({ backgroundColor: "rgb(65, 82, 190)" }),
    document: {
      querySelectorAll: () => [{
        innerText: label,
        className: "active",
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: 180, height: 60, top: 10 })
      }]
    },
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("activeLiga")}\nresult={liga:activeLiga(),blocked:ACTIVE_LIGA_BLOCKED};`, context);
  return context.result;
}

assert.deepEqual(JSON.parse(JSON.stringify(testActiveLiga("BET365", "Express"))), { liga: null, blocked: true });
assert.deepEqual(JSON.parse(JSON.stringify(testActiveLiga("BET365", "Copa"))), { liga: 1, blocked: false });

function testWhiteEdge(points) {
  const context = { result: null };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("nativeWhiteEdge")}\nresult=nativeWhiteEdge(${JSON.stringify(points)},10);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

const whiteUp = testWhiteEdge([
  { x: 0, v: 30, delta: 0, marker: "red" },
  { x: 1, v: 35, delta: 5, marker: "white" },
  { x: 2, v: 35, delta: 0, marker: "green" }
]);
assert.equal(whiteUp.direction, "subindo");
assert.equal(whiteUp.count, 1);
assert.equal(whiteUp.age, 1);
assert.equal(whiteUp.recent, true);

const whiteDown = testWhiteEdge([
  { x: 0, v: 35, delta: 0, marker: "green" },
  { x: 1, v: 30, delta: -5, marker: "white" },
  { x: 2, v: 30, delta: 0, marker: "red" }
]);
assert.equal(whiteDown.direction, "descendo");
assert.equal(whiteDown.move, -5);

const whiteSum = testWhiteEdge([
  { x: 0, v: 30, delta: 0, marker: "red" },
  { x: 1, v: 35, delta: 5, marker: "white" },
  { x: 2, v: 35, delta: 0, marker: "green" },
  { x: 3, v: 40, delta: 5, marker: "white" },
  { x: 4, v: 35, delta: -5, marker: "white" },
  { x: 5, v: 35, delta: 0, marker: "red" }
]);
assert.equal(whiteSum.count, 3);
assert.equal(whiteSum.up, 2);
assert.equal(whiteSum.down, 1);
assert.equal(whiteSum.net, 5);
assert.equal(whiteSum.recentNet, 5);
assert.equal(whiteSum.direction, "subindo");

function independentlyParseFtResults(rows) {
  const results = [];
  for (const row of rows) {
    const cells = Array.isArray(row?.c) ? row.c : [];
    for (let index = cells.length - 1; index >= 1 && results.length < 420; index -= 1) {
      const lines = String(cells[index]?.v || "").replace(/\r/g, "").trim().split("\n");
      const firstLineScore = lines[0]?.match(/(\d+)\+?\s*-\s*(\d+)\+?\s*$/);
      const separateScore = lines.slice(1).join("\n").match(/(\d+)\+?\s*-\s*(\d+)\+?/);
      const match = firstLineScore || separateScore;
      if (match) results.push({ casa: Number(match[1]), fora: Number(match[2]) });
    }
  }
  return results;
}

function independentlyCalculateSeries(results, market, requested = 120) {
  const used = results.slice(0, requested);
  const blockCount = Math.floor(used.length / 20);
  if (blockCount < 2) return { values: [], markerKinds: [] };
  const pays = (game) => {
    const total = game.casa + game.fora;
    if (market === "over25") return total > 2.5;
    if (market === "over35") return total > 3.5;
    return game.casa > 0 && game.fora > 0;
  };
  const blocks = Array.from({ length: blockCount }, (_, index) => used.slice(index * 20, index * 20 + 20));
  const newest = blocks.at(-1);
  const values = [newest.filter(pays).length / newest.length * 100];
  const markerKinds = ["white"];
  for (let block = blockCount - 2; block >= 0; block -= 1) {
    for (let index = 19; index >= 0; index -= 1) {
      const currentPays = pays(blocks[block][index]);
      const referencePays = pays(blocks[block + 1][index]);
      values.push(values.at(-1) + (currentPays && !referencePays ? 5 : !currentPays && referencePays ? -5 : 0));
      markerKinds.push(currentPays && referencePays ? "green" : !currentPays && !referencePays ? "red" : "white");
    }
  }
  return { values, markerKinds };
}

if (process.env.BBTIPS_LIVE_JSON) {
  const live = JSON.parse(fs.readFileSync(process.env.BBTIPS_LIVE_JSON, "utf8"));
  const liveRows = live?.table?.rows || [];
  const independentResults = independentlyParseFtResults(liveRows);
  assert.ok(independentResults.length >= 40, "JSON real precisa ter ao menos dois blocos completos");
  const summaries = [];
  for (const [scannerMarket, market] of [["over25", "over25"], ["over35", "over35"], ["ambas_sim", "ambas sim"]]) {
    const actualPoints = Array.from(run({ cfg: {}, rows: liveRows, scannerMarket }).points);
    const actual = actualPoints.map(
      (point) => Number(point.v)
    );
    const expected = independentlyCalculateSeries(independentResults, market);
    assert.deepEqual(actual, expected.values, `${market}: serie interna divergiu da conferencia independente`);
    assert.deepEqual(actualPoints.map((point) => String(point.marker)), expected.markerKinds, `${market}: cores internas divergiram da conferencia independente`);
    summaries.push(`${market} brancas=${expected.markerKinds.filter((kind) => kind === "white").length} verdes=${expected.markerKinds.filter((kind) => kind === "green").length} vermelhas=${expected.markerKinds.filter((kind) => kind === "red").length}`);
  }
  console.log(`graph-native-live: ok (${independentResults.length} placares FT; ${summaries.join("; ")})`);
}

console.log("graph-native: ok");
