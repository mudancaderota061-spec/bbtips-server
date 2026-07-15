const GRAPH_DATA_URLS = {
  1: "https://www.caramelotips.com.br/final/copa.json",
  2: "https://www.caramelotips.com.br/final/euro.json",
  3: "https://www.caramelotips.com.br/final/super.json",
  4: "https://www.caramelotips.com.br/final/premier.json",
  5: "https://www.caramelotips.com.br/final/split.json"
};
const API_BASE = "https://bbtips-server.onrender.com";

const graphDataCache = new Map();

async function fetchGraphData(liga) {
  const url = GRAPH_DATA_URLS[liga];
  if (!url) throw new Error("Liga invalida");
  const cached = graphDataCache.get(liga);
  if (cached && Date.now() - cached.ts < 15000) return cached.json;
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json?.table?.rows)) throw new Error("JSON sem linhas");
  graphDataCache.set(liga, { ts: Date.now(), json });
  return json;
}

async function loginUser(username, password) {
  let response = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, user: username, password })
  });
  if (!response.ok) {
    response = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
  }
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (parseError) {
    data = {};
  }
  if (!response.ok) {
    const fallback = response.status === 401 || response.status === 403
      ? "Login, senha ou licenca nao liberada."
      : `Servidor respondeu erro ${response.status}.`;
    return { ok: false, status: response.status, error: data.message || data.error || fallback };
  }
  return { ok: true, data };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BBTIPS_FETCH_GRAPH_DATA") {
    const liga = Number(message.liga);
    fetchGraphData(liga)
      .then((json) => sendResponse({ ok: true, json }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "BBTIPS_LOGIN") {
    loginUser(String(message.username || ""), String(message.password || ""))
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: `Falha no login: ${error?.message || error}` }));
    return true;
  }
  return false;
});
