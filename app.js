(function () {
  "use strict";

  const STORAGE_KEYS = {
    rates: "fx.rates",
    updated: "fx.updated",
    history: "fx.history",
    pinned: "fx.pinned",
    prefs: "fx.prefs"
  };

  const MAX_HISTORY = 12;
  const FETCH_TIMEOUT = 12000;

  const CURRENCIES = [
    "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF",
    "INR", "MXN", "BRL", "ZAR", "SEK", "NZD", "SGD", "HKD",
    "KRW", "NOK", "DKK", "PLN", "CZK", "TRY", "RUB", "AED",
    "SAR", "THB", "IDR", "MYR", "PHP", "VND", "ILS", "EGP",
    "NGN", "KES", "GHS", "PKR", "BDT", "LKR", "UAH", "HUF",
    "RON", "BGN", "HRK", "ISK", "CLP", "COP", "PEN", "ARS"
  ];

  // USD-based approximation used only when every network source fails.
  const OFFLINE_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.78, JPY: 155, CNY: 7.25, AUD: 1.52,
    CAD: 1.37, CHF: 0.88, INR: 88, MXN: 19.5, BRL: 5.4, ZAR: 18.5,
    SEK: 10.5, NZD: 1.66, SGD: 1.33, HKD: 7.78, KRW: 1450, NOK: 11.2,
    PLN: 4.1, CZK: 23.5, TRY: 42, AED: 3.67, SAR: 3.75, THB: 36,
    IDR: 16500, MYR: 4.4, PHP: 58, VND: 26000, ILS: 3.6, EGP: 50,
    NGN: 1550, KES: 129, GHS: 15.5, PKR: 285, BDT: 122, LKR: 300,
    UAH: 42, HUF: 380, RON: 4.55, BGN: 1.8, ISK: 135, CLP: 960,
    COP: 4200, PEN: 3.8, ARS: 1450, DKK: 6.9, BHD: 0.376,
    JOD: 0.709, KWD: 0.306, QAR: 3.64, OMR: 0.385, TND: 3.1,
    DZD: 133, MAD: 10.1, XOF: 605, XAF: 605, CDF: 2850, ETB: 138,
    TZS: 2650, UGX: 3650, RWF: 1440, ZMW: 28, MWK: 1750, MZN: 64,
    AOA: 920, BWP: 13.5, NAD: 18.5, SCR: 14.5, MUR: 46
  };

  const SOURCES = [
    {
      name: "er-api",
      url: "https://open.er-api.com/v6/latest/USD",
      parse: function (data) {
        if (data.result !== "success" || !data.rates) throw new Error("bad payload");
        return { rates: normalize(data.rates), updated: (data.time_last_update_unix || 0) * 1000 };
      }
    },
    {
      name: "exchangerate-api",
      url: "https://api.exchangerate-api.com/v4/latest/USD",
      parse: function (data) {
        if (!data.rates) throw new Error("bad payload");
        return { rates: normalize(data.rates), updated: Date.parse(data.date) || Date.now() };
      }
    },
    {
      name: "jsdelivr",
      url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
      parse: function (data) {
        if (!data.usd) throw new Error("bad payload");
        return { rates: normalize(data.usd), updated: Date.parse(data.date) || Date.now() };
      }
    }
  ];

  const els = {
    amount: document.getElementById("amount"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    swap: document.getElementById("swap"),
    result: document.getElementById("result-value"),
    rate: document.getElementById("result-rate"),
    pin: document.getElementById("pin"),
    refresh: document.getElementById("refresh"),
    pinnedList: document.getElementById("pinned-list"),
    historyList: document.getElementById("history-list"),
    clearPins: document.getElementById("clear-pins"),
    clearHistory: document.getElementById("clear-history"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    footer: document.getElementById("footer-info")
  };

  let rates = null;
  let lastUpdated = null;
  let rateSource = null;
  let usingOffline = false;
  let lastFetchError = null;
  let history = readJSON(STORAGE_KEYS.history, []);
  let pinned = readJSON(STORAGE_KEYS.pinned, []);

  function normalize(raw) {
    const out = {};
    Object.keys(raw).forEach(function (k) {
      const code = k.toUpperCase();
      const v = parseFloat(raw[k]);
      if (isFinite(v) && v > 0 && CURRENCIES.indexOf(code) !== -1) out[code] = v;
    });
    if (Object.keys(out).indexOf("USD") === -1) out.USD = 1;
    return out;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      setStatus("err", "Browser storage is blocked");
      return false;
    }
  }

  function setStatus(state, text) {
    els.statusDot.className = "dot " + state;
    els.statusText.textContent = text;
  }

  function round(value, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * f) / f;
  }

  function fmtMoney(value, code) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2
      }).format(value);
    } catch (e) {
      return round(value, 2).toLocaleString() + " " + code;
    }
  }

  function fmtRate(rate) {
    if (rate >= 100) return round(rate, 2).toLocaleString();
    if (rate >= 1) return round(rate, 4).toLocaleString();
    return round(rate, 6).toLocaleString();
  }

  function fmtDate(ms) {
    if (!ms) return "unknown";
    try { return new Date(ms).toLocaleString(); } catch (e) { return "unknown"; }
  }

  function fillSelects() {
    const saved = readJSON(STORAGE_KEYS.prefs, { from: "USD", to: "EUR" });
    CURRENCIES.forEach(function (code) {
      els.from.add(new Option(code, code));
      els.to.add(new Option(code, code));
    });
    els.from.value = CURRENCIES.indexOf(saved.from) !== -1 ? saved.from : "USD";
    els.to.value = CURRENCIES.indexOf(saved.to) !== -1 ? saved.to : "EUR";
  }

  function savePrefs() {
    writeJSON(STORAGE_KEYS.prefs, { from: els.from.value, to: els.to.value });
  }

  function convert(amount, from, to) {
    if (!rates || !rates[from] || !rates[to]) return null;
    return (amount / rates[from]) * rates[to];
  }

  function render() {
    const amount = parseFloat(els.amount.value);
    const from = els.from.value;
    const to = els.to.value;

    if (!amount || amount <= 0 || isNaN(amount)) {
      els.result.textContent = "—";
      els.rate.textContent = "";
      return;
    }
    if (!rates) {
      els.result.textContent = "Rates not loaded yet";
      els.rate.textContent = "";
      return;
    }

    const converted = convert(amount, from, to);
    if (converted === null) {
      els.result.textContent = "Unsupported currency";
      els.rate.textContent = "";
      return;
    }

    els.result.textContent = fmtMoney(converted, to);
    els.rate.textContent =
      "1 " + from + " = " + fmtRate(rates[to] / rates[from]) + " " + to +
      "  ·  1 " + to + " = " + fmtRate(rates[from] / rates[to]) + " " + from +
      (usingOffline ? "  ·  approximate" : "");

    els.pin.checked = pinned.some(function (p) {
      return p.from === from && p.to === to;
    });
  }

  function pushHistory() {
    const amount = parseFloat(els.amount.value);
    if (!amount || amount <= 0 || isNaN(amount) || !rates) return;

    const from = els.from.value;
    const to = els.to.value;
    const out = convert(amount, from, to);
    if (out === null) return;

    const entry = { amount: amount, from: from, to: to, out: out, at: Date.now() };

    history = history.filter(function (h) {
      return !(h.amount === entry.amount && h.from === entry.from && h.to === entry.to);
    });
    history.unshift(entry);
    history = history.slice(0, MAX_HISTORY);
    writeJSON(STORAGE_KEYS.history, history);
    renderHistory();
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    if (!history.length) {
      els.historyList.appendChild(emptyRow("No conversions yet."));
      return;
    }
    history.forEach(function (h, i) {
      const li = document.createElement("li");

      const body = document.createElement("div");
      body.innerHTML =
        "<strong>" + fmtMoney(h.out, h.to) + "</strong>" +
        "<span class='sub'>" + fmtMoney(h.amount, h.from) + " · " +
        fmtDate(h.at) + "</span>";

      const actions = document.createElement("div");
      actions.className = "row-actions";

      const use = document.createElement("button");
      use.className = "mini";
      use.textContent = "Load";
      use.addEventListener("click", function () {
        els.amount.value = h.amount;
        els.from.value = h.from;
        els.to.value = h.to;
        savePrefs();
        render();
      });

      const del = document.createElement("button");
      del.className = "mini";
      del.textContent = "×";
      del.addEventListener("click", function () {
        history.splice(i, 1);
        writeJSON(STORAGE_KEYS.history, history);
        renderHistory();
      });

      actions.appendChild(use);
      actions.appendChild(del);
      li.appendChild(body);
      li.appendChild(actions);
      els.historyList.appendChild(li);
    });
  }

  function renderPinned() {
    els.pinnedList.innerHTML = "";
    if (!pinned.length) {
      els.pinnedList.appendChild(emptyRow("Nothing pinned."));
      return;
    }

    pinned.forEach(function (p, i) {
      const li = document.createElement("li");

      const body = document.createElement("div");
      let rateText = "Rates unavailable";
      if (rates && rates[p.from] && rates[p.to]) {
        rateText = "1 " + p.from + " = " + fmtRate(rates[p.to] / rates[p.from]) + " " + p.to;
      }
      body.innerHTML =
        "<strong>" + p.from + " → " + p.to + "</strong>" +
        "<span class='sub'>" + rateText + "</span>";

      const actions = document.createElement("div");
      actions.className = "row-actions";

      const use = document.createElement("button");
      use.className = "mini";
      use.textContent = "Open";
      use.addEventListener("click", function () {
        els.from.value = p.from;
        els.to.value = p.to;
        savePrefs();
        render();
      });

      const del = document.createElement("button");
      del.className = "mini";
      del.textContent = "×";
      del.addEventListener("click", function () {
        pinned.splice(i, 1);
        writeJSON(STORAGE_KEYS.pinned, pinned);
        renderPinned();
        render();
      });

      actions.appendChild(use);
      actions.appendChild(del);
      li.appendChild(body);
      li.appendChild(actions);
      els.pinnedList.appendChild(li);
    });
  }

  function emptyRow(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }

  function togglePin() {
    const from = els.from.value;
    const to = els.to.value;
    const idx = pinned.findIndex(function (p) {
      return p.from === from && p.to === to;
    });

    if (idx >= 0) {
      pinned.splice(idx, 1);
    } else {
      pinned.unshift({ from: from, to: to });
      pinned = pinned.slice(0, 8);
    }
    writeJSON(STORAGE_KEYS.pinned, pinned);
    renderPinned();
    render();
  }

  function renderFooter() {
    const parts = [];
    if (usingOffline) {
      parts.push("Built-in approximate rates (no network)");
      if (lastFetchError) parts.push("Fetch error: " + lastFetchError);
    } else if (lastUpdated) {
      parts.push("Rates updated: " + fmtDate(lastUpdated));
    }
    if (rateSource) parts.push("Source: " + rateSource);
    parts.push("Saved locally in your browser.");
    els.footer.textContent = parts.join(" · ");
  }

  function fetchJSON(url) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT);
    return fetch(url, ctrl ? { signal: ctrl.signal, cache: "no-store" } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") throw new Error("timed out after " + (FETCH_TIMEOUT / 1000) + "s");
        if (err instanceof TypeError) throw new Error("network blocked or offline");
        throw err;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function useOfflineRates() {
    rates = normalize(OFFLINE_RATES);
    usingOffline = true;
    rateSource = "built-in fallback";
    lastUpdated = null;
    setStatus("warn", "Offline — approximate rates");
    renderPinned();
    render();
    renderFooter();
  }

  function fetchRates() {
    els.refresh.disabled = true;
    setStatus("warn", "Fetching rates...");

    const errors = [];
    let chain = Promise.resolve();

    SOURCES.forEach(function (source) {
      chain = chain.then(function (result) {
        if (result) return result;
        return fetchJSON(source.url).then(source.parse).catch(function (err) {
          errors.push(source.name + ": " + (err && err.message ? err.message : err));
          console.warn("[fx] " + source.name + " failed ->", err);
          return null;
        });
      });
    });

    chain
      .then(function (result) {
        if (!result) {
          console.warn("[fx] all sources failed ->", errors);
          if (!rates) {
            lastFetchError = errors[0] || "no source responded";
            useOfflineRates();
          } else {
            setStatus("warn", "Fetch failed — keeping loaded rates");
          }
          return;
        }

        rates = result.rates;
        lastUpdated = result.updated;
        usingOffline = false;
        lastFetchError = null;
        rateSource = "live API";

        writeJSON(STORAGE_KEYS.rates, { rates: rates, updated: lastUpdated, source: rateSource });
        setStatus("ok", "Live rates");

        renderPinned();
        render();
        renderFooter();
      })
      .finally(function () {
        els.refresh.disabled = false;
      });
  }

  function loadCached() {
    const cached = readJSON(STORAGE_KEYS.rates, null);
    if (!cached || !cached.rates) return false;

    const fresh = normalize(cached.rates);
    if (!fresh.USD) return false;

    rates = fresh;
    lastUpdated = cached.updated || null;
    rateSource = (cached.source || "cache") + " (cached)";
    usingOffline = false;
    return true;
  }

  function debounce(fn, wait) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  const debouncedRender = debounce(render, 150);
  const debouncedCommit = debounce(pushHistory, 700);

  function onChange() {
    savePrefs();
    debouncedRender();
    debouncedCommit();
  }

  function init() {
    fillSelects();

    const hasCache = loadCached();
    renderHistory();
    renderPinned();
    render();
    renderFooter();

    if (hasCache) setStatus("warn", "Showing cached rates");

    fetchRates();

    els.amount.addEventListener("input", function () {
      debouncedRender();
      debouncedCommit();
    });
    els.from.addEventListener("change", onChange);
    els.to.addEventListener("change", onChange);

    els.swap.addEventListener("click", function () {
      const f = els.from.value;
      els.from.value = els.to.value;
      els.to.value = f;
      onChange();
    });

    els.pin.addEventListener("change", togglePin);
    els.refresh.addEventListener("click", fetchRates);

    els.clearHistory.addEventListener("click", function () {
      history = [];
      writeJSON(STORAGE_KEYS.history, history);
      renderHistory();
    });

    els.clearPins.addEventListener("click", function () {
      pinned = [];
      writeJSON(STORAGE_KEYS.pinned, pinned);
      renderPinned();
      render();
    });
  }

  init();
})();
