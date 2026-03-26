/**
 * log.js — The Log: playout history viewer
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Log() {
  const PAGE_SIZE = 100;

  let state = { q: "", page: 0, total: 0 };

  const logSearch    = document.getElementById("logSearch");
  const logSearchBtn = document.getElementById("logSearchBtn");
  const logBody      = document.getElementById("logBody");
  const logCount     = document.getElementById("logCount");
  const logPrevBtn   = document.getElementById("logPrevPage");
  const logNextBtn   = document.getElementById("logNextPage");
  const logPageLbl   = document.getElementById("logPage");

  async function loadHistory(resetPage) {
    if (resetPage) state.page = 0;
    state.q = logSearch.value.trim();
    const offset = state.page * PAGE_SIZE;
    try {
      const data = await API.get(
        `/api/history?q=${encodeURIComponent(state.q)}&limit=${PAGE_SIZE}&offset=${offset}`
      );
      const rows = data.history ?? data;
      state.total = data.total ?? rows.length;
      renderLog(rows);
      updatePager();
    } catch(e) {
      toast("History load failed: " + e.message, "error");
    }
  }

  function renderLog(rows) {
    if (!rows.length) {
      logBody.innerHTML = `<tr><td colspan="5" class="crate-empty">No history found.</td></tr>`;
      logCount.textContent = "";
      return;
    }
    logCount.textContent = `${state.total} entries`;
    logBody.innerHTML = rows.map(r => {
      const ts  = r.date_played ? new Date(r.date_played).toLocaleString() : "—";
      const dur = fmtDur(r.duration);
      const typeLbl = songTypeLabel(r.song_type ?? 0);
      return `<tr class="track-row ${songTypeClass(r.song_type)}">
        <td>${ts}</td>
        <td>${escHtml(r.artist || "—")}</td>
        <td>${escHtml(r.title || "—")}</td>
        <td>${dur}</td>
        <td><span class="type-badge">${typeLbl}</span></td>
      </tr>`;
    }).join("");
  }

  function updatePager() {
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    logPageLbl.textContent = `Page ${state.page + 1} of ${totalPages}`;
    logPrevBtn.disabled = state.page === 0;
    logNextBtn.disabled = (state.page + 1) >= totalPages;
  }

  logSearchBtn.addEventListener("click", () => loadHistory(true));
  logSearch.addEventListener("keydown", e => { if (e.key === "Enter") loadHistory(true); });
  logPrevBtn.addEventListener("click",  () => { state.page--; loadHistory(false); });
  logNextBtn.addEventListener("click",  () => { state.page++; loadHistory(false); });

  document.addEventListener("tt:panelActive", e => {
    if (e.detail === "panelLog") loadHistory(true);
  });
})();
