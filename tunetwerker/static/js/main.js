/**
 * main.js — TUNE/TWERKER core bootstrap, API layer, nav, shared state
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

// ── Global app state ────────────────────────────────────────────────────────
window.TT = {
  currentTrack: null,       // Track currently loaded in cue editor
  nowPlaying: null,         // Track on air right now
  queue: [],                // Current queue array
  categories: [],           // Subcategory list
  genres: [],               // Genre list
  pollInterval: null,       // Polling timer for on-air status
  POLL_MS: 4000,            // How often to poll Liquidsoap
};

// ── API helpers ─────────────────────────────────────────────────────────────
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  },

  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
    return r.json();
  },

  async put(path, body) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
    return r.json();
  },

  async del(path) {
    const r = await fetch(path, { method: "DELETE" });
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
    return r.json();
  },

  async postForm(path, formData) {
    const r = await fetch(path, { method: "POST", body: formData });
    if (!r.ok) throw new Error(`POST form ${path} → ${r.status}`);
    return r.json();
  },
};
window.API = API;

// ── Utility helpers ─────────────────────────────────────────────────────────
function fmtDur(secs) {
  if (!secs && secs !== 0) return "—";
  secs = Math.round(secs);
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}
window.fmtDur = fmtDur;

function fmtDurMs(secs) {
  if (!secs && secs !== 0) return "0:00.000";
  const m = Math.floor(secs / 60);
  const ms = (secs % 60).toFixed(3).padStart(6, "0");
  return `${m}:${ms}`;
}
window.fmtDurMs = fmtDurMs;

function songTypeLabel(t) {
  const map = ["Music","Jingle/ID","Voice Track","Commercial","News",
               "Sweeper","Promo","Imaging","Intro","Outro"];
  return map[t] ?? `Type ${t}`;
}
window.songTypeLabel = songTypeLabel;

function songTypeClass(t) {
  const map = ["type-music","type-jingle","type-vt","type-commercial","type-news",
               "type-sweeper","type-promo","type-imaging","type-intro","type-outro"];
  return map[t] ?? "";
}
window.songTypeClass = songTypeClass;

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
window.escHtml = escHtml;

// ── Navigation ───────────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.panel;
      document.getElementById(target).classList.add("active");

      // Fire panel-activated events so each module can lazy-load
      document.dispatchEvent(new CustomEvent("tt:panelActive", { detail: target }));
    });
  });
}

// ── Liquidsoap status polling ────────────────────────────────────────────────
async function pollLiquidsoap() {
  try {
    const data = await API.get("/api/liquidsoap/status");
    const dot = document.getElementById("liqDot");
    const lbl = document.getElementById("liqLabel");

    if (data.connected) {
      dot.classList.add("connected");
      lbl.textContent = "LS ✓";

      // Parse now-playing from Liquidsoap (returns "artist - title" or path)
      if (data.now_playing) {
        updateNowPlayingBar(data.now_playing);
      }
    } else {
      dot.classList.remove("connected");
      lbl.textContent = "LS ✗";
    }
  } catch (e) {
    document.getElementById("liqDot").classList.remove("connected");
  }
}

function updateNowPlayingBar(npStr) {
  // npStr could be "Artist - Title" or a filepath
  let artist = "", title = npStr;
  if (npStr.includes(" - ")) {
    const parts = npStr.split(" - ");
    artist = parts[0].trim();
    title  = parts.slice(1).join(" - ").trim();
  }
  document.getElementById("npArtist").textContent = artist;
  document.getElementById("npTitle").textContent  = title;
}

// ── Skip button ──────────────────────────────────────────────────────────────
function initSkipBtn() {
  document.getElementById("btnSkip").addEventListener("click", async () => {
    try {
      await API.post("/api/skip", {});
    } catch(e) {
      console.warn("Skip failed:", e);
    }
  });
}

// ── Master volume ────────────────────────────────────────────────────────────
function initVolume() {
  const slider = document.getElementById("masterVolume");
  const valLbl = document.getElementById("volVal");
  slider.addEventListener("input", async () => {
    valLbl.textContent = slider.value;
    const vol = parseInt(slider.value) / 100;
    try {
      await fetch(`/api/settings/liquidsoap/volume`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // Also poke Liquidsoap directly via backend if we add a volume endpoint
    } catch(e) { /* best-effort */ }
  });
}

// ── Populate select dropdowns with categories / genres ───────────────────────
async function loadLookups() {
  try {
    const [subcats, genres] = await Promise.all([
      API.get("/api/subcategories"),
      API.get("/api/genres"),
    ]);
    TT.categories = subcats;
    TT.genres     = genres;

    // Populate every <select> that needs categories or genres
    populateSelect("crateSubcat",   subcats, "id_subcat",  "subcat_name", "All Categories");
    populateSelect("crateGenre",    genres,  "id",         "genre",       "All Genres");
    populateSelect("metaSubcat",    subcats, "id_subcat",  "subcat_name");
    populateSelect("metaGenre",     genres,  "id",         "genre",       "None");
    populateSelect("importSubcat",  subcats, "id_subcat",  "subcat_name");
    populateSelect("importGenre",   genres,  "id",         "genre",       "None");
    populateSelect("vtSubcat",      subcats, "id_subcat",  "subcat_name");

    // Dispatch so modules that built too early can re-fill their selects
    document.dispatchEvent(new CustomEvent("tt:lookupsLoaded"));
  } catch(e) {
    console.error("Failed to load lookups:", e);
  }
}

function populateSelect(id, items, valKey, labelKey, blankLabel) {
  const sel = document.getElementById(id);
  if (!sel) return;
  // Keep existing blank option if present
  const current = sel.value;
  sel.innerHTML = blankLabel
    ? `<option value="0">${escHtml(blankLabel)}</option>`
    : "";
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item[valKey] ?? item.id ?? 0;
    opt.textContent = item[labelKey] ?? item.name ?? item.genre ?? "—";
    sel.appendChild(opt);
  });
  sel.value = current || sel.options[0]?.value || "0";
}
window.populateSelect = populateSelect;

// ── Toast notifications ──────────────────────────────────────────────────────
function toast(msg, type = "info") {
  let container = document.getElementById("ttToasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "ttToasts";
    container.style.cssText = [
      "position:fixed","bottom:1rem","right:1rem","z-index:9999",
      "display:flex","flex-direction:column","gap:.4rem","pointer-events:none"
    ].join(";");
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.style.cssText = [
    "background:var(--skin-bg-secondary)","border:1px solid var(--skin-border)",
    "border-left:4px solid var(--skin-accent)","color:var(--skin-text)",
    "padding:.5rem 1rem","border-radius:var(--skin-radius)",
    "font-size:.85rem","max-width:320px","pointer-events:none",
    "transition:opacity .3s","opacity:1",
  ].join(";");
  if (type === "error") el.style.borderLeftColor = "var(--skin-danger)";
  if (type === "ok")    el.style.borderLeftColor = "var(--skin-success)";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
}
window.toast = toast;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initSkipBtn();
  initVolume();
  loadLookups();

  // Start Liquidsoap polling
  pollLiquidsoap();
  TT.pollInterval = setInterval(pollLiquidsoap, TT.POLL_MS);
});
