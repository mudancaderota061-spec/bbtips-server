const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const content = read("content.js");
const pageHook = read("page-hook.js");
const robot = read("robot.js");
const robo = read("robo.js");
const html = read("public/virtual.html");
const app = read("public/virtual.js");
const server = read("src/server.js");

assert.equal(manifest.version, "1.0.85");
assert.ok(manifest.host_permissions.includes("https://bbtips-server.onrender.com/*"));
assert.equal(manifest.content_scripts[0].run_at, "document_start");
assert.ok(manifest.web_accessible_resources[0].resources.includes("page-hook.js"));
assert.match(content, /injectEarlyApiHook\(\)/);
assert.doesNotMatch(content, /!rows\.length \|\| \(!meta\.force/);
assert.match(pageHook, /__BBTIPS_CAPTURED_API/);
assert.match(pageHook, /withoutOlderCopy\.slice\(-8\)/);
assert.match(pageHook, /bbtips-api-captured/);

for (const file of ["content.js", "background.js", "popup.js"]) {
  assert.match(read(file), /https:\/\/bbtips-server\.onrender\.com/);
}

assert.equal(robot, robo, "robot.js e robo.js precisam permanecer identicos");
assert.match(robot, /ligas:\[1,2,3,4,5\]/);
assert.match(robot, /radarLigas:\[1,2,3,4,5\]/);
assert.doesNotMatch(robot, /6:"Express"/);
assert.match(robot, /if\(best===6&&currentPlatform\(\)==="BET365"\)/);
assert.match(robot, /autoApi:true/);
assert.match(robot, /scannerTelemetry:true/);
assert.match(robot, /const ligas=CONFIG\.radarLigas/);
assert.match(robot, /BBTIPS_SCANNER_COLLECT_TIMER=setInterval\(\(\)=>sendAgenteLocal\(rowsForTelemetry\(\)\),30000\)/);
assert.doesNotMatch(robot, /BBTIPS_SCANNER_COLLECT_TIMER=setInterval\(\(\)=>sendAgenteLocal\(rowsForTelemetry\(\),\{force:true\}\),30000\)/);
assert.match(robot, /api:"dom-grid-history"/);
assert.match(robot, /name:`Resultado \$\{time\}`/);
assert.doesNotMatch(robot, /if\(!rows\.length\|\|\(!force&&now-AGENTE_LOCAL_TS<30000\)\)return/);

assert.match(html, /id="overMarket"/);
assert.match(html, /id="underMarket"/);
assert.match(html, /id="ambasMarket"/);
assert.match(html, /Coleta automatica BBTips/);
assert.match(html, /id="accountStatus"/);
assert.match(html, /id="loginToast"/);
assert.match(app, /setActiveMarket\(localStorage\.getItem\("virtualProMarket"\)/);
assert.match(app, /CONECTADO COMO/);
assert.match(app, /Login confirmado/);
assert.match(app, /setLoggedInUI\(true\)/);
assert.match(app, /Atualizacao automatica:/);
assert.match(app, /limit: "3000"/);
assert.match(app, /}, 20000\);/);

assert.match(server, /const telemetryEventLimit = 12/);
assert.match(server, /Math\.min\(5000, Number\(req\.query\.limit\)/);
assert.match(server, /A API do BBTips bloqueia consultas feitas pelo Render/);

for (const filter of ["o05", "u05", "o15", "u15", "o25", "u25", "o35", "u35", "ambs", "ambn"]) {
  assert.ok(server.includes(filter), `filtro ausente no servidor: ${filter}`);
}

console.log("automatic collector: ok");
