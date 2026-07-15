(function () {
  "use strict";

  const Z = 2147483647;
  const PANEL_POS_KEY = "bbtips-robo-panel-pos";
  const PANEL_MIN_KEY = "bbtips-robo-panel-min";
  const PATTERN_HISTORY_KEY = "bbtips-robo-pattern-history-v2";
  const LAST_PATTERN_KEY = "bbtips-robo-last-pattern-v2";
  const RIGHT_FOCUS_RATIO = 0.34;
  const LOOP_MS = 2600;
  const SLOW_SCAN_MS = 6500;
  const SCORE_RE = /(?:^|[^\d])(\d{1,2})\s*[-xX]\s*(\d{1,2})(?=$|[^\d])/g;
  let panel;
  let canvas;
  let dragging = null;
  let cachedHistChart = null;
  let cachedHist = [];
  let cachedMarket = null;
  let lastSlowScan = 0;
  let patternMemory = [];

  function ready(fn) {
    if (document.body) fn();
    else setTimeout(() => ready(fn), 100);
  }

  function start() {
    makePanel();
    makeCanvas();
    setInterval(loop, LOOP_MS);
    loop();
  }

  function makePanel() {
    if (document.getElementById("bbtips-robo-root")) return;

    panel = document.createElement("div");
    panel.id = "bbtips-robo-root";
    const savedPos = readJson(PANEL_POS_KEY, { left: 18, top: 90 });
    panel.setAttribute(
      "style",
      [
        "position:fixed!important",
        "left:" + savedPos.left + "px!important",
        "top:" + savedPos.top + "px!important",
        "z-index:" + Z + "!important",
        "width:300px!important",
        "background:#050505!important",
        "color:#fff!important",
        "border:4px solid #00ff66!important",
        "border-radius:10px!important",
        "padding:14px!important",
        "font-family:Arial,sans-serif!important",
        "box-shadow:0 0 0 4px rgba(0,255,102,.25),0 18px 44px rgba(0,0,0,.55)!important"
      ].join(";")
    );

    panel.innerHTML = [
      '<div id="bbtips-drag" style="display:flex;align-items:center;justify-content:space-between;gap:8px;color:#00ff66;font-size:18px;font-weight:900;margin-bottom:8px;cursor:move;user-select:none">',
      '<span>ROBO BBTIPS LIGADO</span>',
      '<button id="bbtips-min" type="button" style="cursor:pointer;background:#111;color:#00ff66;border:1px solid #00ff66;border-radius:6px;font-size:18px;font-weight:900;width:34px;height:28px;line-height:20px">_</button>',
      "</div>",
      '<div id="bbtips-body">',
      '<div id="bbtips-status" style="font-size:13px;color:#ccc;margin-bottom:10px">procurando grafico...</div>',
      '<div id="bbtips-sinal" style="font-size:28px;font-weight:900;text-align:center;border:2px solid #ffd54a;color:#ffd54a;border-radius:8px;padding:10px;margin-bottom:10px">ANALISANDO</div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">',
      box("Forca", "bbtips-forca", "--"),
      box("Zona", "bbtips-zona", "--"),
      box("Virada", "bbtips-virada", "--"),
      box("Pagamento", "bbtips-pagamento", "--"),
      box("Pgto %", "bbtips-pgto-score", "--"),
      box("Histograma", "bbtips-hist", "--"),
      box("Direcao", "bbtips-direcao", "--"),
      box("Orientacao", "bbtips-acao", "Aguardar"),
      "</div>",
      '<div style="margin-top:10px;padding:10px;background:rgba(0,255,102,.08);border:1px solid rgba(0,255,102,.26);border-radius:8px;font-size:12px;line-height:1.45">',
      '<strong style="color:#00ff66;font-size:13px">AMBAS + OVER</strong><br>',
      'BTTS(8): <span id="bbtips-btts" style="font-weight:800">--</span> | ',
      'O2.5(8): <span id="bbtips-over" style="font-weight:800">--</span><br>',
      'O3.5(8): <span id="bbtips-over35" style="font-weight:800">--</span> | ',
      'Media gols: <span id="bbtips-gols" style="font-weight:800">--</span> | ',
      'Seq: <span id="bbtips-seq" style="font-weight:800">--</span><br>',
      '<span id="bbtips-recomendacao" style="display:block;margin-top:4px;font-weight:900;font-size:15px;color:#ffd54a">AGUARDAR</span>',
      "</div>",
      '<div style="margin-top:10px;padding:10px;background:rgba(255,213,74,.08);border:1px solid rgba(255,213,74,.35);border-radius:8px;font-size:12px;line-height:1.45">',
      '<strong style="color:#ffd54a;font-size:13px">BACKTEST VISUAL</strong><br>',
      '<span id="bbtips-bt-status">juntando memoria...</span><br>',
      'O2.5: <span id="bbtips-bt-over" style="font-weight:800">--</span> | ',
      'O3.5: <span id="bbtips-bt-over35" style="font-weight:800">--</span><br>',
      'Ambas: <span id="bbtips-bt-btts" style="font-weight:800">--</span><br>',
      '<span id="bbtips-bt-sinal" style="display:block;margin-top:4px;font-weight:900;color:#ffd54a">AGUARDAR</span>',
      "</div>",
      '<div id="bbtips-nota" style="font-size:12px;line-height:1.35;color:#ddd;margin-top:10px">Se voce esta vendo este painel, a extensao esta funcionando.</div>',
      "</div>"
    ].join("");

    document.documentElement.appendChild(panel);
    wirePanelControls();
  }

  function wirePanelControls() {
    const drag = document.getElementById("bbtips-drag");
    const min = document.getElementById("bbtips-min");
    const body = document.getElementById("bbtips-body");
    const minimized = localStorage.getItem(PANEL_MIN_KEY) === "1";
    setMinimized(minimized);

    drag.addEventListener("pointerdown", (event) => {
      if (event.target === min) return;
      const r = panel.getBoundingClientRect();
      dragging = {
        dx: event.clientX - r.left,
        dy: event.clientY - r.top
      };
      drag.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const left = clamp(event.clientX - dragging.dx, 0, window.innerWidth - panel.offsetWidth);
      const top = clamp(event.clientY - dragging.dy, 0, window.innerHeight - 44);
      panel.style.setProperty("left", left + "px", "important");
      panel.style.setProperty("top", top + "px", "important");
    });

    window.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = null;
      const r = panel.getBoundingClientRect();
      localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
    });

    min.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = body.style.display !== "none";
      setMinimized(next);
      localStorage.setItem(PANEL_MIN_KEY, next ? "1" : "0");
    });
  }

  function setMinimized(minimized) {
    const body = document.getElementById("bbtips-body");
    const min = document.getElementById("bbtips-min");
    if (!body || !min) return;
    body.style.display = minimized ? "none" : "block";
    min.textContent = minimized ? "+" : "_";
    panel.style.setProperty("width", minimized ? "260px" : "300px", "important");
  }

  function setGraphPanelActive(active) {
    if (panel) panel.style.setProperty("display", active ? "block" : "none", "important");
    if (canvas) canvas.style.setProperty("display", active ? "block" : "none", "important");
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function box(label, id, value) {
    return [
      '<div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:7px">',
      '<b style="display:block;color:#aaa;font-size:11px;margin-bottom:4px">' + label + "</b>",
      '<span id="' + id + '" style="font-weight:800;color:#fff">' + value + "</span>",
      "</div>"
    ].join("");
  }

  function makeCanvas() {
    canvas = document.createElement("canvas");
    canvas.id = "bbtips-robo-desenho";
    canvas.setAttribute(
      "style",
      "position:fixed!important;left:0!important;top:0!important;pointer-events:none!important;z-index:" + (Z - 1) + "!important"
    );
    document.documentElement.appendChild(canvas);
  }

  function loop() {
    if (!panel || !canvas) return;

    const chart = biggestChart();
    if (!chart) {
      setGraphPanelActive(false);
      clearDraw();
      return;
    }

    setGraphPanelActive(true);
    const points = readPoints(chart);
    if (points.length < 20) {
      write({
        status: "grafico encontrado, lendo pontos...",
        sinal: "LENDO",
        color: "#ffd54a",
        forca: "--",
        zona: "--",
        direcao: "--",
        virada: "--",
        pagamento: "--",
        pgtoScore: "--",
        hist: "--",
        btts: "--",
        over: "--",
        gols: "--",
        seq: "--",
        recomendacao: "AGUARDAR",
        acao: "Aguardar",
        nota: "Achei o grafico. Estou tentando transformar a linha em pontos para analisar tendencia."
      });
      drawFrame(chart, "#ffd54a");
      return;
    }

    const histChart = findHistogramChart(chart);
    const hist = histChart ? readHistogram(histChart) : [];
    const goalsData = readMatchGoals();
    const market = analyzeBTTSandOver(goalsData);
    const focusedPoints = focusRightEdge(points);
    const a = analyze(focusedPoints, hist, market, points);
    try {
      rememberPattern(goalsData, a.graphState);
      a.backtest = analyzeVisualBacktest(a.graphState);
      applyBacktestCaution(a);
    } catch (e) {
      a.backtest = {
        status: "erro isolado",
        over: "--",
        btts: "--",
        sinal: "BACKTEST PAUSADO",
        color: "#ffd54a"
      };
    }
    write(a);
    draw(chart, focusedPoints, a, histChart);
  }

  function applyBacktestCaution(a) {
    const rec = String(a.recomendacao || "");
    const bt = String(a.backtest?.sinal || "");
    const goodRecent = rec.includes("ENTRAR") || rec.includes("BOM");
    const badBacktest = bt.includes("RUIM") || bt.includes("EVITAR");
    const goodBacktest = bt.includes("BOM");
    const graphAgainst = String(a.direcao || "").includes("Descendo") && !String(a.sinal || "").includes("PAGAR");

    if (goodRecent && (badBacktest || graphAgainst)) {
      a.recomendacao = badBacktest ? "AGUARDAR (BT RUIM)" : "AGUARDAR (GRAFICO CONTRA)";
      return;
    }

    if (rec === "AGUARDAR" && goodBacktest && !graphAgainst) {
      a.recomendacao = bt.includes("O3.5") ? "OBSERVAR OVER 3.5" : "OBSERVAR OVER";
    }
  }

  function biggestChart() {
    return chartCandidates()[0]?.el;
  }

  function chartCandidates() {
    return Array.from(document.querySelectorAll("canvas,svg"))
      .filter((el) => !String(el.id || "").startsWith("bbtips-robo"))
      .filter((el) => !el.closest("#bbtips-robo-root"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 350 && x.r.height > 180 && x.r.bottom > 0 && x.r.right > 0)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  }

  function findHistogramChart(priceChart) {
    if (!priceChart) return null;
    const priceBox = priceChart.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll("canvas,svg"))
      .filter((el) => el !== priceChart)
      .filter((el) => !String(el.id || "").startsWith("bbtips-robo"))
      .filter((el) => !el.closest("#bbtips-robo-root"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((item) => item.r.width > 300 && item.r.height > 70)
      .filter((item) => item.r.bottom > 0 && item.r.right > 0)
      .filter((item) => item.r.top >= priceBox.bottom - 18)
      .filter((item) => item.r.top <= priceBox.bottom + 520)
      .filter((item) => horizontalOverlap(item.r, priceBox) > 0.55)
      .map((item) => ({ ...item, score: histogramScore(item.el) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.r.top - b.r.top);
    if (candidates[0]?.el) return candidates[0].el;

    const inferred = inferHistogramRegion(priceBox);
    return readDomHistogram(inferred).length >= 8 ? inferred : null;
  }

  function inferHistogramRegion(priceBox) {
    const top = priceBox.bottom + 4;
    const bottom = Math.min(window.innerHeight - 8, top + Math.max(170, priceBox.height * 0.42));
    const rect = {
      left: priceBox.left,
      top,
      right: priceBox.right,
      bottom,
      width: priceBox.width,
      height: bottom - top
    };
    return {
      __bbtipsRegion: true,
      getBoundingClientRect: () => rect
    };
  }

  function horizontalOverlap(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    return Math.max(0, right - left) / Math.max(1, Math.min(a.width, b.width));
  }

  function histogramScore(el) {
    const points = readHistogram(el);
    if (points.length < 8) return 0;
    const signs = new Set(points.slice(-40).map((p) => Math.sign(p.v)).filter(Boolean));
    const box = el.getBoundingClientRect();
    return points.length + signs.size * 20 + Math.max(0, 220 - box.height) * 0.05;
  }

  function readPoints(el) {
    if (el.tagName.toLowerCase() === "svg") return readSvg(el);
    return readCanvas(el);
  }

  function readSvg(svg) {
    const items = Array.from(svg.querySelectorAll("path,polyline,polygon"))
      .map((shape) => sampleShape(svg, shape))
      .filter((p) => p.length > 20)
      .sort((a, b) => b.length - a.length);
    return (items[0] || []).sort((a, b) => a.x - b.x);
  }

  function sampleShape(svg, shape) {
    const tag = shape.tagName.toLowerCase();
    if (tag !== "path") {
      return (shape.getAttribute("points") || "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite))
        .map(([x, y]) => svgPoint(svg, x, y));
    }
    const len = shape.getTotalLength ? shape.getTotalLength() : 0;
    if (!len) return [];
    const out = [];
    for (let i = 0; i <= 160; i += 1) {
      const p = shape.getPointAtLength((len * i) / 160);
      out.push(svgPoint(svg, p.x, p.y));
    }
    return out;
  }

  function svgPoint(svg, x, y) {
    const p = svg.createSVGPoint();
    const box = svg.getBoundingClientRect();
    p.x = x;
    p.y = y;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: box.left + x, y: box.top + y };
    const m = p.matrixTransform(ctm);
    return { x: m.x, y: m.y };
  }

  function readCanvas(c) {
    try {
      const box = c.getBoundingClientRect();
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return [];
      const w = c.width;
      const h = c.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      const sx = box.width / w;
      const sy = box.height / h;
      const step = Math.max(2, Math.floor(w / 220));
      const cols = [];
      const topLimit = Math.round(h * 0.08);
      const bottomLimit = Math.round(h * 0.92);
      const rightLimit = Math.min(w - 2, Math.round(w * 0.975));

      for (let x = 0; x <= rightLimit; x += step) {
        const blueYs = [];
        const whiteYs = [];
        const dotYs = [];
        for (let y = topLimit; y < bottomLimit; y += 2) {
          const i = (y * w + x) * 4;
          const r = img[i];
          const g = img[i + 1];
          const b = img[i + 2];
          const a = img[i + 3];
          const green = a > 120 && g > 120 && g > r * 1.15 && g > b * 1.05;
          const red = a > 120 && r > 150 && r > g * 1.15 && r > b * 1.15;
          const yellow = a > 120 && r > 175 && g > 135 && b < 120 && r > b * 1.7 && g > b * 1.35;
          const blue = a > 120 && b > 145 && g > 95 && b > r * 1.1;
          const white = a > 150 && r > 215 && g > 215 && b > 215;
          if (blue) blueYs.push(y);
          else if (white) whiteYs.push(y);
          else if (green || red || yellow) dotYs.push(y);
        }
        if (blueYs.length || whiteYs.length || dotYs.length) {
          cols.push({ x, blueYs, whiteYs, dotYs });
        }
      }

      const tracked = trackRightEdgeLine(cols, w);
      return tracked.map((p) => ({ x: box.left + p.x * sx, y: box.top + p.y * sy })).sort((a, b) => a.x - b.x);
    } catch (e) {
      return [];
    }
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function nearest(values, target) {
    if (!values.length) return null;
    let best = values[0];
    let bestDist = Math.abs(best - target);
    for (let i = 1; i < values.length; i += 1) {
      const dist = Math.abs(values[i] - target);
      if (dist < bestDist) {
        best = values[i];
        bestDist = dist;
      }
    }
    return best;
  }

  function trackRightEdgeLine(cols, width) {
    if (!cols.length) return [];
    const byX = cols.slice().sort((a, b) => a.x - b.x);
    const rightStart = width * 0.72;
    const hasColoredRightEdge = byX.some((col) => col.x >= rightStart && col.dotYs.length);
    let lastY = null;
    const out = [];

    for (let i = byX.length - 1; i >= 0; i -= 1) {
      const col = byX[i];
      const priceYs = col.dotYs.length ? col.dotYs : col.whiteYs;
      const preferred = priceYs.length ? priceYs : col.blueYs;
      let y = null;

      if (lastY == null) {
        if (col.x < rightStart) continue;
        if (hasColoredRightEdge && !col.dotYs.length) continue;
        if (!priceYs.length) continue;
        y = median(preferred);
      } else {
        const all = col.dotYs.concat(col.whiteYs, col.blueYs);
        const priceNear = nearest(priceYs, lastY);
        const allNear = nearest(all, lastY);
        y = priceNear != null && Math.abs(priceNear - lastY) <= 95 ? priceNear : allNear;
      }

      if (y == null) continue;
      if (lastY != null && Math.abs(y - lastY) > 130) continue;
      out.push({ x: col.x, y });
      lastY = y;
    }

    const result = out.reverse();
    return result.length >= 20 ? result : byX.map((col) => ({ x: col.x, y: median(col.dotYs.length ? col.dotYs : col.whiteYs.length ? col.whiteYs : col.blueYs) })).filter((p) => p.y != null);
  }

  function readHistogram(el) {
    if (el.__bbtipsRegion) return readDomHistogram(el);
    if (el.tagName.toLowerCase() === "svg") return readSvgHistogram(el);
    const canvasHist = readCanvasHistogram(el);
    return canvasHist.length >= 8 ? canvasHist : readDomHistogram(el);
  }

  function readDomHistogram(elOrRegion) {
    const area = elOrRegion.getBoundingClientRect();
    const bars = [];
    const nodes = Array.from(document.querySelectorAll("div,span,rect,path"));

    nodes.forEach((node) => {
      if (node.closest("#bbtips-robo-root")) return;
      if (String(node.id || "").startsWith("bbtips-robo")) return;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 3) return;
      if (r.right < area.left || r.left > area.right || r.bottom < area.top || r.top > area.bottom) return;
      if (r.width > 40 || r.height > area.height * 0.95) return;

      const style = getComputedStyle(node);
      const fill = node.getAttribute?.("fill") || "";
      const stroke = node.getAttribute?.("stroke") || "";
      const colorText = [style.backgroundColor, style.color, style.borderColor, fill, stroke].join(" ").toLowerCase();
      const color = colorSignal(colorText);
      if (!color) return;

      bars.push({
        x: r.left + r.width / 2,
        y: r.top,
        v: color * Math.max(1, r.height)
      });
    });

    return compactBars(bars).sort((a, b) => a.x - b.x);
  }

  function colorSignal(text) {
    const rgb = text.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) {
      const r = Number(rgb[1]);
      const g = Number(rgb[2]);
      const b = Number(rgb[3]);
      if (g > 105 && g > r * 1.15 && g > b * 1.05) return 1;
      if (r > 130 && r > g * 1.15 && r > b * 1.15) return -1;
    }
    if (text.includes("green") || text.includes("#0f") || text.includes("#00") || text.includes("4caf") || text.includes("22c55")) return 1;
    if (text.includes("red") || text.includes("#f") || text.includes("ef44") || text.includes("ff") || text.includes("e539")) return -1;
    return 0;
  }

  function compactBars(bars) {
    const byX = new Map();
    bars.forEach((bar) => {
      const key = Math.round(bar.x / 4) * 4;
      const prev = byX.get(key);
      if (!prev || Math.abs(bar.v) > Math.abs(prev.v)) byX.set(key, bar);
    });
    return Array.from(byX.values());
  }

  function readSvgHistogram(svg) {
    const box = svg.getBoundingClientRect();
    const rects = Array.from(svg.querySelectorAll("rect"))
      .map((rect) => {
        const r = rect.getBoundingClientRect();
        const fill = String(rect.getAttribute("fill") || rect.style.fill || "").toLowerCase();
        const green = fill.includes("0, 255") || fill.includes("green") || fill.includes("#0") || fill.includes("4caf");
        const red = fill.includes("255, 0") || fill.includes("red") || fill.includes("#f") || fill.includes("e539");
        if (!green && !red) return null;
        return { x: r.left + r.width / 2, v: (green ? 1 : -1) * Math.max(1, r.height), y: r.top };
      })
      .filter(Boolean)
      .filter((p) => p.x >= box.left && p.x <= box.right);
    return rects.sort((a, b) => a.x - b.x);
  }

  function readCanvasHistogram(c) {
    try {
      const box = c.getBoundingClientRect();
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return [];
      const w = c.width;
      const h = c.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      const sx = box.width / w;
      const step = Math.max(2, Math.floor(w / 180));
      const out = [];

      for (let x = 0; x < w; x += step) {
        let green = 0;
        let red = 0;
        for (let y = 0; y < h; y += 2) {
          const i = (y * w + x) * 4;
          const r = img[i];
          const g = img[i + 1];
          const b = img[i + 2];
          const a = img[i + 3];
          if (a < 120) continue;
          if (g > 115 && g > r * 1.2 && g > b * 1.05) green += 1;
          if (r > 150 && r > g * 1.15 && r > b * 1.15) red += 1;
        }
        if (green || red) {
          out.push({
            x: box.left + x * sx,
            y: box.top + box.height / 2,
            v: green >= red ? green : -red
          });
        }
      }

      return out.sort((a, b) => a.x - b.x);
    } catch (e) {
      return [];
    }
  }

  function analyzeHistogram(hist) {
    if (!hist || hist.length < 12) {
      return {
        ok: false,
        label: "nao lido",
        bias: 0,
        rising: false,
        weakening: false,
        flipUp: false,
        flipDown: false,
        positive: false
      };
    }

    const recent = hist.slice(-Math.max(8, Math.round(hist.length * 0.22)));
    const prev = hist.slice(-Math.max(16, Math.round(hist.length * 0.44)), -recent.length);
    const avgRecent = avg(recent.map((p) => p.v));
    const avgPrev = avg(prev.map((p) => p.v));
    const absRecent = avg(recent.map((p) => Math.abs(p.v)));
    const absPrev = avg(prev.map((p) => Math.abs(p.v)));
    const positiveCount = recent.filter((p) => p.v > 0).length;
    const negativeCount = recent.filter((p) => p.v < 0).length;
    const positive = positiveCount >= negativeCount;
    const rising = avgRecent > avgPrev && absRecent >= absPrev * 0.85;
    const weakening = positive ? avgRecent < avgPrev * 0.82 : avgRecent > avgPrev * 0.82;
    const flipUp = avgPrev < 0 && avgRecent > 0;
    const flipDown = avgPrev > 0 && avgRecent < 0;
    const label = (positive ? "verde" : "vermelho") + " " + (weakening ? "fraco" : "forte") + " (" + hist.length + ")";

    return {
      ok: true,
      label,
      bias: avgRecent,
      rising,
      weakening,
      flipUp,
      flipDown,
      positive
    };
  }

  function avg(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  }

  function focusRightEdge(points) {
    if (!points || points.length < 25) return points || [];
    const ordered = points.slice().sort((a, b) => a.x - b.x);
    const minX = ordered[0].x;
    const maxX = ordered[ordered.length - 1].x;
    const startX = maxX - (maxX - minX) * RIGHT_FOCUS_RATIO;
    const focused = ordered.filter((p) => p.x >= startX);
    return focused.length >= 18 ? focused : ordered.slice(-45);
  }

  function readMatchGoals() {
    const domGoals = readDomMatchGoals();
    if (domGoals.length >= 8) return domGoals;

    const storedGoals = readStoredMatchGoals();
    if (storedGoals.length >= 8) return storedGoals;

    return domGoals.length ? domGoals : storedGoals;
  }

  function readDomMatchGoals() {
    const candidates = Array.from(document.querySelectorAll("text,tspan,span,div,td"))
      .map((el) => {
        if (el.closest?.("#bbtips-robo-root,#bbtips-final-robo")) return null;
        if (el.closest?.("script,style,noscript,button,input,select,textarea")) return null;
        const box = el.getBoundingClientRect();
        if (!isVisibleBox(el, box)) return null;
        const text = scoreTextFromNode(el);
        const score = parseScoreText(text);
        if (!score) return null;
        return {
          key: Math.round(box.left) + ":" + Math.round(box.top) + ":" + score.a + "x" + score.b,
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          area: box.width * box.height,
          total: score.t,
          btts: score.a > 0 && score.b > 0,
          over25: score.t >= 3,
          over35: score.t >= 4,
          score: score.a + "x" + score.b
        };
      })
      .filter(Boolean);

    const unique = [];
    const seen = new Set();
    candidates
      .sort((a, b) => a.x - b.x || a.y - b.y || a.area - b.area)
      .forEach((item) => {
        const bucket = Math.round(item.x / 16) + ":" + Math.round(item.y / 12) + ":" + item.score;
        if (seen.has(bucket)) return;
        seen.add(bucket);
        unique.push(item);
      });

    return unique.slice(-20);
  }

  function isVisibleBox(el, box) {
    if (!box || box.width < 4 || box.height < 4) return false;
    if (box.bottom <= 0 || box.right <= 0 || box.top >= window.innerHeight || box.left >= window.innerWidth) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05;
  }

  function scoreTextFromNode(el) {
    const direct = Array.from(el.childNodes || [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.nodeValue || "")
      .join(" ")
      .trim()
      .replace(/\s+/g, " ");
    const text = direct || (el.children?.length ? "" : (el.textContent || ""));
    return String(text || "").trim().replace(/\s+/g, " ");
  }

  function parseScoreText(text) {
    if (!text || text.length > 80) return null;
    SCORE_RE.lastIndex = 0;
    const matches = Array.from(String(text).matchAll(SCORE_RE));
    if (matches.length !== 1) return null;
    const a = Number(matches[0][1]);
    const b = Number(matches[0][2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > 12 || b > 12) return null;
    return { a, b, t: a + b };
  }

  function readStoredMatchGoals() {
    const rows = [];
    const addRows = (value) => {
      if (Array.isArray(value)) rows.push(...value);
    };

    try { addRows(window.BBTipsRobo?.historico?.()); } catch (e) {}
    addRows(readJson("BBTIPS_FINAL_RESULTADOS_HIST_V1", []));
    addRows(readJson("BBTIPS_FINAL_API_ROWS_V2", []));

    const seen = new Set();
    const goals = [];
    rows.forEach((row, index) => {
      if (!row || row.future) return;
      const score = scoreFromStoredRow(row);
      if (!score) return;
      const name = String(row.name || row.Nome || row.jogo || row.Jogo || "").toLowerCase().replace(/\s+/g, " ").trim();
      const time = String(row.time || row.Horario || row.horario || row.Hora || row.hora || "");
      const key = [time, name, score.a + "-" + score.b].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      goals.push({
        key,
        x: index,
        y: 0,
        age: resultAgeFromTime(time, index),
        total: score.t,
        btts: score.a > 0 && score.b > 0,
        over25: score.t >= 3,
        over35: score.t >= 4,
        score: score.a + "x" + score.b
      });
    });

    return goals
      .sort((a, b) => a.age - b.age)
      .slice(0, 20)
      .reverse()
      .map(({ age, ...goal }) => goal);
  }

  function scoreFromStoredRow(row) {
    const raw = row.score || row.Resultado || row.resultado || row.Placar || row.placar || "";
    if (raw && typeof raw === "object") {
      const a = Number(raw.a ?? raw.home ?? raw.casa ?? raw.Casa);
      const b = Number(raw.b ?? raw.away ?? raw.fora ?? raw.Fora);
      if (Number.isFinite(a) && Number.isFinite(b)) return { a, b, t: a + b };
    }
    return parseScoreText(String(raw));
  }

  function resultAgeFromTime(time, fallback) {
    const match = String(time || "").match(/^(\d{1,2})[.:](\d{2})$/);
    if (!match) return 99999 + fallback / 1000;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 99999 + fallback / 1000;
    const nowDate = new Date();
    const now = nowDate.getHours() * 60 + nowDate.getMinutes();
    let age = now - (h * 60 + m);
    if (age < 0) age += 1440;
    return age;
  }

  function analyzeBTTSandOver(goalsData) {
    if (!goalsData || goalsData.length < 8) {
      return {
        ok: false,
        btts8: "--",
        over8: "--",
        over35: "--",
        mediaGols: "--",
        sequenciaBTTS: 0,
        sequenciaOver: 0,
        sequenciaOver35: 0,
        recomendacao: "SEM PLACARES"
      };
    }

    const last8 = goalsData.slice(-8);
    const btts8n = (last8.filter((g) => g.btts).length / last8.length) * 100;
    const over8n = (last8.filter((g) => g.over25).length / last8.length) * 100;
    const over35n = (last8.filter((g) => g.over35).length / last8.length) * 100;
    const avgGoals = last8.reduce((sum, g) => sum + g.total, 0) / last8.length;
    const sequenciaBTTS = getStreak(goalsData, "btts");
    const sequenciaOver = getStreak(goalsData, "over25");
    const sequenciaOver35 = getStreak(goalsData, "over35");

    let recomendacao = "AGUARDAR";
    if (btts8n > 75 && over8n > 70 && avgGoals > 3.2 && sequenciaBTTS >= 3) {
      recomendacao = "ENTRAR AMBAS + OVER";
    } else if (over35n >= 50 && over8n >= 62 && avgGoals >= 3.05) {
      recomendacao = "BOM PARA OVER 3.5";
    } else if (btts8n > 65 && over8n > 62 && avgGoals > 2.8) {
      recomendacao = "BOM PARA AMBAS/OVER";
    } else if (btts8n < 45 || over8n < 50 || avgGoals < 2.35) {
      recomendacao = "EVITAR";
    }

    return {
      ok: true,
      btts8: Math.round(btts8n) + "%",
      over8: Math.round(over8n) + "%",
      over35: Math.round(over35n) + "%",
      mediaGols: avgGoals.toFixed(2),
      sequenciaBTTS,
      sequenciaOver,
      sequenciaOver35,
      recomendacao
    };
  }

  function getStreak(data, type) {
    let streak = 0;
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if ((type === "btts" && data[i].btts) || (type === "over25" && data[i].over25) || (type === "over35" && data[i].over35)) streak += 1;
      else break;
    }
    return streak;
  }

  function rememberPattern(goalsData, graphState) {
    if (!goalsData?.length || !graphState) return;
    const history = readPatternHistory();
    const seen = new Set(history.map((item) => item.key));
    let added = 0;

    goalsData.forEach((goal, index) => {
      const key = goal.key || [index, goal.score, goal.total, goal.btts ? 1 : 0, goal.over25 ? 1 : 0].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      added += 1;
      history.push({
        key,
        ts: Date.now(),
        zonePct: graphState.zonePct,
        force: graphState.force,
        histPositive: graphState.histPositive,
        histWeakening: graphState.histWeakening,
        slope: graphState.slope,
        result: {
          total: goal.total,
          btts: goal.btts,
          over25: goal.over25,
          over35: goal.over35,
          score: goal.score
        }
      });
    });

    if (!added) return;
    while (history.length > 80) history.shift();
    safeSetJson(PATTERN_HISTORY_KEY, history);
    safeSetJson(LAST_PATTERN_KEY, { added, ts: Date.now() });
  }

  function analyzeVisualBacktest(graphState) {
    const history = readPatternHistory();
    if (!graphState || history.length < 8) {
      return { status: history.length + "/8 amostras", over: "--", over35: "--", btts: "--", sinal: "MEMORIA INSUFICIENTE", color: "#ffd54a" };
    }

    const similar = history
      .map((item) => ({ item, score: similarityScore(graphState, item) }))
      .filter((x) => x.score >= 58)
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map((x) => x.item);

    if (similar.length < 4) {
      return { status: "similares " + similar.length + " de " + history.length, over: "--", over35: "--", btts: "--", sinal: "SEM PADRAO FORTE", color: "#ffd54a" };
    }

    const overWins = similar.filter((x) => x.result?.over25).length;
    const over35Wins = similar.filter((x) => x.result?.over35).length;
    const bttsWins = similar.filter((x) => x.result?.btts).length;
    const overPct = Math.round((overWins / similar.length) * 100);
    const over35Pct = Math.round((over35Wins / similar.length) * 100);
    const bttsPct = Math.round((bttsWins / similar.length) * 100);
    let sinal = "AGUARDAR";
    let color = "#ffd54a";

    if (overPct >= 70 && bttsPct >= 55 && graphState.force >= 40 && graphState.zonePct < 75 && (graphState.histPositive || !graphState.histWeakening)) {
      sinal = "PADRAO BOM OVER";
      color = "#00ff66";
    } else if (over35Pct >= 50 && overPct >= 65 && graphState.force >= 35 && graphState.zonePct < 78) {
      sinal = "PADRAO BOM O3.5";
      color = "#00ff66";
    } else if (overPct <= 42 || (graphState.zonePct > 75 && graphState.histWeakening)) {
      sinal = "PADRAO RUIM / EVITAR";
      color = "#ff4d5f";
    }

    return {
      status: "similares " + similar.length + " de " + history.length,
      over: overWins + "/" + similar.length + " " + overPct + "%",
      over35: over35Wins + "/" + similar.length + " " + over35Pct + "%",
      btts: bttsWins + "/" + similar.length + " " + bttsPct + "%",
      sinal,
      color
    };
  }

  function similarityScore(now, old) {
    let score = 100;
    score -= Math.min(38, Math.abs(now.zonePct - Number(old.zonePct || 0)) * 1.15);
    score -= Math.min(26, Math.abs(now.force - Number(old.force || 0)) * 0.55);
    score -= Math.min(18, Math.abs(now.slope - Number(old.slope || 0)) * 12);
    if (Boolean(now.histPositive) !== Boolean(old.histPositive)) score -= 18;
    if (Boolean(now.histWeakening) !== Boolean(old.histWeakening)) score -= 8;
    return Math.max(0, Math.round(score));
  }

  function readPatternHistory() {
    const raw = readJson(PATTERN_HISTORY_KEY, patternMemory);
    if (!Array.isArray(raw)) {
      localStorage.removeItem(PATTERN_HISTORY_KEY);
      return [];
    }
    const clean = raw
      .map((item) => {
        if (!item?.result) return null;
        const total = Number(item.result.total);
        const over35 = typeof item.result.over35 === "boolean" ? item.result.over35 : Number.isFinite(total) ? total >= 4 : false;
        return { ...item, result: { ...item.result, over35 } };
      })
      .filter((item) =>
        item &&
        Number.isFinite(Number(item.zonePct)) &&
        Number.isFinite(Number(item.force)) &&
        Number.isFinite(Number(item.slope)) &&
        item.result &&
        typeof item.result.over25 === "boolean" &&
        typeof item.result.over35 === "boolean" &&
        typeof item.result.btts === "boolean"
      );
    patternMemory = clean.slice(-80);
    return patternMemory;
  }

  function safeSetJson(key, value) {
    if (key === PATTERN_HISTORY_KEY && Array.isArray(value)) patternMemory = value.slice(-80);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      try { localStorage.removeItem(key); } catch (x) {}
    }
  }

  function analyze(points, hist, market, allPoints) {
    const smooth = ema(points.map((p) => ({ ...p, v: -p.y })), 8);
    const histA = analyzeHistogram(hist);
    const last = smooth.slice(-Math.max(8, Math.round(smooth.length * 0.22)));
    const prev = smooth.slice(-Math.max(16, Math.round(smooth.length * 0.44)), -last.length);
    const micro = smooth.slice(-Math.min(7, smooth.length));
    const s1 = slope(last);
    const s0 = slope(prev);
    const sMicro = slope(micro);
    const vol = volatility(smooth) || 1;
    const score = s1 / vol;
    const rawEdge = points.slice(-Math.min(6, points.length)).map((p) => ({ ...p, v: -p.y }));
    const edgeMove = rawEdge.length >= 2 ? rawEdge[rawEdge.length - 1].v - rawEdge[0].v : 0;
    const edgeVol = volatility(rawEdge) || vol;
    const microScore = (edgeMove / Math.max(1, rawEdge.length - 1)) / Math.max(0.01, edgeVol);
    const force = Math.min(100, Math.round(Math.abs(score) * 85));
    const baseForZone = allPoints && allPoints.length > points.length ? allPoints.map((p) => ({ ...p, v: -p.y })) : smooth;
    const values = baseForZone.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const currentPoint = smooth[smooth.length - 1];
    const currentPointRaw = points.slice().sort((a, b) => a.x - b.x).pop() || currentPoint;
    const current = currentPoint.v;
    const zonePct = Math.round(((current - min) / range) * 100);
    const zone =
      zonePct <= 25 ? "Fundo" :
      zonePct <= 42 ? "Baixa" :
      zonePct >= 78 ? "Topo" :
      zonePct >= 62 ? "Alta" :
      "Meio";

    let sinal = "LATERAL";
    let color = "#ffd54a";
    let acao = "Aguardar";
    let pagamento = "--";
    let nota = "Tendencia fraca ou embolada. Melhor esperar confirmar direcao.";
    if (score > 0.22) {
      sinal = "ALTA";
      color = "#00ff66";
      acao = "Favorece alta";
      nota = "O grafico esta ganhando inclinacao para cima. Tendencia favorece continuidade de alta enquanto mantiver forca.";
    }
    if (score < -0.22) {
      sinal = "BAIXA";
      color = "#ff4d5f";
      acao = "Favorece baixa";
      nota = "O grafico esta perdendo terreno e inclinando para baixo. Tendencia favorece baixa enquanto mantiver forca.";
    }

    const pontaCaindo = microScore < -0.28;
    const pontaSubindo = microScore > 0.28;
    if (pontaCaindo) {
      sinal = score > 0.18 ? "RECUO" : "BAIXA";
      color = "#ff4d5f";
      acao = score > 0.18 ? "Nao comprar topo" : "Observar baixa";
      nota = "A media maior ainda pode estar alta, mas a ponta direita esta caindo agora. O robo prioriza a ponta atual.";
    } else if (pontaSubindo && score > -0.18) {
      sinal = "ALTA";
      color = "#00ff66";
      acao = "Observar alta";
      nota = "A ponta direita esta subindo agora. Confirmar se o proximo ponto mantem a reacao.";
    }

    let virada = "Sem virada";
    if (s0 < -0.08 && s1 > 0.08) {
      virada = "Virando p/ alta";
      color = "#00ff66";
      acao = "Observar alta";
    }
    if (s0 > 0.08 && s1 < -0.08) {
      virada = "Virando p/ baixa";
      color = "#ff4d5f";
      acao = "Observar baixa";
    }

    const pontoSubida = zonePct <= 35 && (s1 > 0.05 || (s0 < -0.05 && s1 > -0.02));
    const histConfirmaAlta = !histA.ok || histA.flipUp || (histA.positive && !histA.weakening);
    const histPedePagamento = histA.ok && ((histA.positive && histA.weakening && zonePct >= 55) || histA.flipDown);
    const slopeWeakening = s0 > 0.04 && s1 < s0 * 0.55;
    const payScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          zonePct * 0.45 +
          (histPedePagamento ? 35 : 0) +
          (slopeWeakening ? 18 : 0) +
          (zonePct >= 76 ? 18 : 0) -
          (score > 0.42 && histA.positive && !histA.weakening ? 18 : 0)
        )
      )
    );
    const subidaConfirmada = zonePct > 35 && zonePct < 68 && score > 0.22 && force >= 35 && histConfirmaAlta;
    const pagarParcial = zonePct >= 62 && score > 0.05 && (histPedePagamento || zonePct >= 72);
    const pagarForte = zonePct >= 76 || (s0 > 0.08 && s1 < 0.03 && zonePct >= 58) || (histA.flipDown && zonePct >= 52);
    const riscoCompra = zonePct >= 72 && score <= 0.12;
    const facaCaindo = zonePct <= 35 && score < -0.18;

    if (pontoSubida) {
      sinal = "PONTO SUBIDA";
      color = "#00ff66";
      acao = "Entrada com cautela";
      pagamento = "Mirar meio/topo";
      nota = histA.ok && !histConfirmaAlta
        ? "Preco em zona boa, mas histograma ainda nao confirmou. Melhor esperar a barra verde aparecer ou o vermelho perder forca."
        : "Preco em zona baixa/fundo e histograma ajudando. Esse e o ponto que favorece buscar subida do mercado lido.";
    }

    if (subidaConfirmada) {
      sinal = "SUBIDA ATIVA";
      color = "#00ff66";
      acao = "Seguir tendencia";
      pagamento = "Parcial no topo";
      nota = "A subida ja saiu do fundo e tem inclinacao. Melhor leitura e acompanhar ate perder forca ou chegar perto do topo.";
    }

    if (pagarParcial) {
      pagamento = "Parcial possivel";
      nota = "O grafico ja esta em zona alta e o histograma mostra perda de impulso ou aproximacao do topo. Se entrou embaixo, aqui e area de pagamento parcial.";
    }

    if (pagarForte) {
      sinal = "PAGAMENTO";
      color = "#ffd54a";
      acao = "Proteger lucro";
      pagamento = "Pagar/evitar nova";
      nota = "Confluencia de topo/perda de forca com histograma. Para quem pegou o mercado de baixo, e ponto provavel de pagamento; para nova entrada, risco aumenta.";
    }

    if (riscoCompra) {
      sinal = "RISCO ALTO";
      color = "#ff4d5f";
      acao = "Evitar compra";
      pagamento = "Ja passou";
      nota = "A linha esta alta demais para buscar subida nova sem correcao. Melhor esperar voltar para zona baixa ou confirmar outro ciclo.";
    }

    if (facaCaindo) {
      sinal = "AGUARDAR FUNDO";
      color = "#ffd54a";
      acao = "Nao antecipar";
      pagamento = "--";
      nota = "Esta barato/baixo, mas ainda caindo. O robo espera a queda perder forca antes de chamar ponto de subida.";
    }

    if (histA.ok && histA.flipUp && zonePct <= 55 && score > -0.1) {
      sinal = "COMPRA NASCENDO";
      color = "#00ff66";
      acao = "Preparar entrada";
      pagamento = "Alvo parcial meio";
      nota = "Histograma virou para positivo antes do preco chegar no topo. Leitura boa para buscar o primeiro trecho de subida do mercado lido.";
    }

    if (histPedePagamento && zonePct >= 55) {
      sinal = "PAGAMENTO";
      color = "#ffd54a";
      acao = "Pagar/proteger";
      pagamento = "Ponto bom";
      nota = "Histograma perdeu forca enquanto o preco esta em zona media/alta. Esse e o melhor tipo de alerta para pagamento do mercado que esta aberto.";
    }

    if (payScore >= 82) {
      sinal = "PAGAR AGORA";
      color = "#ffd54a";
      acao = "Pagar/proteger";
      pagamento = "Muito bom";
      nota = "Leitura forte de pagamento: preco em zona alta/topo, impulso perdendo forca e histograma deixando de confirmar continuidade.";
    } else if (payScore >= 68) {
      sinal = "PAGAR PARCIAL";
      color = "#ffd54a";
      acao = "Parcial";
      pagamento = "Bom";
      nota = "Boa zona de pagamento parcial. Ainda pode andar, mas a relacao risco/retorno ja pede proteger o mercado.";
    } else if (payScore <= 35 && (pontoSubida || subidaConfirmada)) {
      pagamento = "Ainda cedo";
    }

    if (pontaCaindo) {
      sinal = payScore >= 68 ? "PAGAR PARCIAL" : score > 0.18 ? "ALTA EM RECUO" : "BAIXA";
      color = payScore >= 68 || score > 0.18 ? "#ffd54a" : "#ff4d5f";
      acao = payScore >= 68 ? "Proteger" : "Aguardar";
      nota = "A tendencia maior pode ser de alta, mas a pontinha direita esta descendo. Entao o movimento atual nao e subida; e recuo.";
    }

    return {
      status: points.length + " pts foco | hist " + (hist?.length || 0) + " | ponta direita",
      sinal,
      color,
      forca: force + "%",
      zona: zone + " " + zonePct + "%",
      direcao: pontaCaindo ? "Descendo" : pontaSubindo ? "Subindo" : s1 > 0 ? "Subindo" : s1 < 0 ? "Descendo" : "Neutra",
      virada,
      pagamento,
      pgtoScore: payScore + "%",
      hist: histA.label,
      btts: market?.btts8 || "--",
      over: market?.over8 || "--",
      over35: market?.over35 || "--",
      gols: market?.mediaGols || "--",
      seq: market?.ok ? "A" + market.sequenciaBTTS + "/O2 " + market.sequenciaOver + "/O3 " + market.sequenciaOver35 : "--",
      recomendacao: market?.recomendacao || "SEM PLACARES",
      acao,
      nota,
      smooth,
      currentPoint: currentPointRaw,
      graphState: {
        zonePct,
        force,
        histPositive: histA.ok ? histA.positive : false,
        histWeakening: histA.ok ? histA.weakening : false,
        slope: score
      }
    };
  }

  function ema(points, period) {
    const k = 2 / (period + 1);
    let last = points[0].v;
    return points.map((p, i) => {
      last = i ? p.v * k + last * (1 - k) : p.v;
      return { ...p, v: last, y: -last };
    });
  }

  function slope(points) {
    if (points.length < 2) return 0;
    return (points[points.length - 1].v - points[0].v) / points.length;
  }

  function volatility(points) {
    let sum = 0;
    for (let i = 1; i < points.length; i += 1) sum += Math.abs(points[i].v - points[i - 1].v);
    return sum / Math.max(1, points.length - 1);
  }

  function write(a) {
    text("bbtips-status", a.status);
    text("bbtips-sinal", a.sinal);
    text("bbtips-forca", a.forca);
    text("bbtips-zona", a.zona);
    text("bbtips-direcao", a.direcao);
    text("bbtips-virada", a.virada);
    text("bbtips-pagamento", a.pagamento);
    text("bbtips-pgto-score", a.pgtoScore);
    text("bbtips-hist", a.hist || "lido");
    text("bbtips-btts", a.btts);
    text("bbtips-over", a.over);
    text("bbtips-over35", a.over35);
    text("bbtips-gols", a.gols);
    text("bbtips-seq", a.seq);
    text("bbtips-recomendacao", a.recomendacao);
    text("bbtips-acao", a.acao);
    text("bbtips-nota", a.nota);
    text("bbtips-bt-status", a.backtest?.status || "juntando memoria...");
    text("bbtips-bt-over", a.backtest?.over || "--");
    text("bbtips-bt-over35", a.backtest?.over35 || "--");
    text("bbtips-bt-btts", a.backtest?.btts || "--");
    text("bbtips-bt-sinal", a.backtest?.sinal || "AGUARDAR");
    const s = document.getElementById("bbtips-sinal");
    if (s) {
      s.style.color = a.color;
      s.style.borderColor = a.color;
    }
    const rec = document.getElementById("bbtips-recomendacao");
    if (rec) {
      const value = String(a.recomendacao || "");
      rec.style.color = value.includes("ENTRAR") || value.includes("BOM") ? "#00ff66" : value.includes("EVITAR") ? "#ff4d5f" : "#ffd54a";
    }
    const bt = document.getElementById("bbtips-bt-sinal");
    if (bt) bt.style.color = a.backtest?.color || "#ffd54a";
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function prep() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  function clearDraw() {
    if (!canvas) return;
    prep();
  }

  function drawFrame(el, color) {
    const ctx = prep();
    const r = el.getBoundingClientRect();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(r.left, r.top, r.width, r.height);
  }

  function draw(el, points, a, histChart) {
    const ctx = prep();
    const r = el.getBoundingClientRect();
    ctx.strokeStyle = a.color || "#00ff66";
    ctx.lineWidth = 4;
    ctx.strokeRect(r.left, r.top, r.width, r.height);

    if (histChart) {
      const hr = histChart.getBoundingClientRect();
      ctx.strokeStyle = "#ffd54a";
      ctx.lineWidth = 4;
      ctx.strokeRect(hr.left, hr.top, hr.width, hr.height);
      ctx.fillStyle = "#ffd54a";
      ctx.font = "900 14px Arial";
      ctx.fillText("HISTOGRAMA LIDO", hr.left + 12, hr.top + 22);
    }

    drawCurrentPoint(ctx, a.currentPoint || points[points.length - 1]);
  }

  function drawCurrentPoint(ctx, point) {
    if (!point) return;
    const x = point.x;
    const y = point.y;

    ctx.save();
    ctx.strokeStyle = "rgba(255,213,74,.74)";
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  ready(start);
})();
