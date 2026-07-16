(() => {
  if (window.__BBTIPS_EARLY_API_HOOK) return;
  window.__BBTIPS_EARLY_API_HOOK = true;

  const interesting = value => /api\.thtips\.com\.br|futebolvirtual|\/final\//i.test(String(value || ""));
  const remember = (url, text) => {
    if (!interesting(url) && !/"(?:Linhas|linhas|table)"\s*:/i.test(String(text || "").slice(0, 1200))) return;
    const normalizedUrl = String(url || "");
    const queue = Array.isArray(window.__BBTIPS_CAPTURED_API) ? window.__BBTIPS_CAPTURED_API : [];
    const withoutOlderCopy = queue.filter(item => String(item?.url || "") !== normalizedUrl);
    withoutOlderCopy.push({ url: normalizedUrl, text: String(text || ""), capturedAt: Date.now() });
    window.__BBTIPS_CAPTURED_API = withoutOlderCopy.slice(-8);
    window.dispatchEvent(new CustomEvent("bbtips-api-captured"));
  };

  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = String(args[0]?.url || args[0] || "");
      const response = await originalFetch.apply(this, args);
      if (interesting(url)) {
        try {
          response.clone().text().then(text => remember(url, text)).catch(() => {});
        } catch (_error) {}
      }
      return response;
    };
    window.__BBTIPS_FINAL_API_HOOK = true;
  }

  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__bbtipsEarlyUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        if (!interesting(this.__bbtipsEarlyUrl)) return;
        try {
          remember(this.__bbtipsEarlyUrl, this.responseText || "");
        } catch (_error) {}
      });
      return originalSend.apply(this, args);
    };
    window.__BBTIPS_FINAL_XHR_HOOK = true;
  }
})();
