/**
 * crate.js — The Crate: library browser with search, pagination, import
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Crate() {
  const PAGE_SIZE = 75;

  let state = {
    q: "",
    subcat: 0,
    genre: 0,
    song_type: -1,
    page: 0,
    total: 0,
  };

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const searchInput  = document.getElementById("crateSearch");
  const subcatSel    = document.getElementById("crateSubcat");
  const genreSel     = document.getElementById("crateGenre");
  const typeSel      = document.getElementById("crateSongType");
  const searchBtn    = document.getElementById("crateSearchBtn");
  const importBtn    = document.getElementById("crateImportBtn");
  const countLbl     = document.getElementById("crateCount");
  const crateBody    = document.getElementById("crateBody");
  const prevPageBtn  = document.getElementById("cratePrevPage");
  const nextPageBtn  = document.getElementById("crateNextPage");
  const pageLbl      = document.getElementById("cratePage");

  // ── Search ────────────────────────────────────────────────────────────────
  async function doSearch(resetPage) {
    if (resetPage) state.page = 0;

    state.q         = searchInput.value.trim();
    state.subcat    = parseInt(subcatSel.value) || 0;
    state.genre     = parseInt(genreSel.value) || 0;
    state.song_type = parseInt(typeSel.value);

    const offset = state.page * PAGE_SIZE;
    const url = `/api/songs?q=${encodeURIComponent(state.q)}`
      + `&subcat=${state.subcat}&genre=${state.genre}`
      + `&song_type=${state.song_type}`
      + `&limit=${PAGE_SIZE}&offset=${offset}`;

    try {
      const data = await API.get(url);
      renderRows(data.songs ?? data);
      state.total = data.total ?? (data.songs ?? data).length;
      updatePager();
    } catch(e) {
      toast("Search failed: " + e.message, "error");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderRows(songs) {
    if (!songs.length) {
      crateBody.innerHTML = `<tr class="crate-empty"><td colspan="9">No tracks found.</td></tr>`;
      countLbl.textContent = "0 tracks";
      return;
    }
    countLbl.textContent = `${state.total} tracks`;

    crateBody.innerHTML = songs.map(s => {
      const typeLabel = songTypeLabel(s.song_type ?? 0);
      const typeCls   = songTypeClass(s.song_type ?? 0);
      const dur       = fmtDur(s.duration);
      const bpm       = s.bpm ? Number(s.bpm).toFixed(1) : "—";
      const year      = s.year || "—";
      const plays     = s.count_played ?? 0;
      const hasCues   = s.cue_times && s.cue_times !== "&";

      return `<tr class="track-row ${typeCls}" data-id="${s.id}">
        <td class="col-type"><span class="type-badge ${typeCls}">${escHtml(typeLabel)}</span></td>
        <td class="col-artist">${escHtml(s.artist || "—")}</td>
        <td class="col-title">
          ${escHtml(s.title || "—")}
          ${hasCues ? '<span class="cue-badge" title="Has cue data">✂</span>' : ""}
        </td>
        <td class="col-album">${escHtml(s.album || "")}</td>
        <td class="col-dur">${dur}</td>
        <td class="col-bpm">${bpm}</td>
        <td class="col-year">${year}</td>
        <td class="col-plays">${plays}</td>
        <td class="col-actions">
          <button class="btn btn-sm btn-icon" data-action="cue" data-id="${s.id}" title="Edit Cues">✂️</button>
          <button class="btn btn-sm btn-icon" data-action="queue" data-id="${s.id}" title="Add to Queue">+</button>
        </td>
      </tr>`;
    }).join("");
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  function updatePager() {
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    pageLbl.textContent = `Page ${state.page + 1} of ${totalPages}`;
    prevPageBtn.disabled = state.page === 0;
    nextPageBtn.disabled = (state.page + 1) >= totalPages;
  }

  // ── Row action delegation ─────────────────────────────────────────────────
  crateBody.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id     = parseInt(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === "cue") {
      openInCueEditor(id);
    } else if (action === "queue") {
      await addToQueue(id);
    }
  });

  // ── Double-click row → load into cue editor ───────────────────────────────
  crateBody.addEventListener("dblclick", e => {
    const row = e.target.closest(".track-row");
    if (!row) return;
    openInCueEditor(parseInt(row.dataset.id));
  });

  async function openInCueEditor(songId) {
    try {
      const song = await API.get(`/api/songs/${songId}`);
      TT.currentTrack = song;
      document.dispatchEvent(new CustomEvent("tt:loadTrack", { detail: song }));
      // Switch to Cue Editor tab
      document.querySelector('[data-panel="panelCue"]').click();
    } catch(e) {
      toast("Could not load track: " + e.message, "error");
    }
  }

  async function addToQueue(songId) {
    try {
      await API.post(`/api/queue/${songId}`, {});
      toast("Added to queue ✓", "ok");
      document.dispatchEvent(new Event("tt:queueChanged"));
    } catch(e) {
      toast("Queue add failed: " + e.message, "error");
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────
  searchBtn.addEventListener("click", () => doSearch(true));
  searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(true); });
  prevPageBtn.addEventListener("click", () => { state.page--; doSearch(false); });
  nextPageBtn.addEventListener("click", () => { state.page++; doSearch(false); });

  subcatSel.addEventListener("change",  () => doSearch(true));
  genreSel.addEventListener("change",   () => doSearch(true));
  typeSel.addEventListener("change",    () => doSearch(true));

  importBtn.addEventListener("click", openImportModal);

  // ── Load-track modal (from Cue Editor "Load Track" button) ────────────────
  const loadTrackModal   = document.getElementById("loadTrackModal");
  const loadTrackClose   = document.getElementById("loadTrackClose");
  const loadTrackSearch  = document.getElementById("loadTrackSearch");
  const loadTrackResults = document.getElementById("loadTrackResults");

  document.getElementById("cueBtnLoad").addEventListener("click", () => {
    loadTrackModal.style.display = "flex";
    loadTrackSearch.focus();
  });
  loadTrackClose.addEventListener("click", () => {
    loadTrackModal.style.display = "none";
  });
  loadTrackModal.addEventListener("click", e => {
    if (e.target === loadTrackModal) loadTrackModal.style.display = "none";
  });

  let ltDebounce;
  loadTrackSearch.addEventListener("input", () => {
    clearTimeout(ltDebounce);
    ltDebounce = setTimeout(async () => {
      const q = loadTrackSearch.value.trim();
      if (!q) { loadTrackResults.innerHTML = ""; return; }
      try {
        const data = await API.get(`/api/songs?q=${encodeURIComponent(q)}&limit=20`);
        const songs = data.songs ?? data;
        loadTrackResults.innerHTML = songs.map(s =>
          `<div class="quickadd-item" data-id="${s.id}">
            <span class="qa-type ${songTypeClass(s.song_type)}">${songTypeLabel(s.song_type)}</span>
            <span class="qa-artist">${escHtml(s.artist)}</span>
            <span class="qa-title">${escHtml(s.title)}</span>
            <span class="qa-dur">${fmtDur(s.duration)}</span>
          </div>`
        ).join("") || "<div class='queue-empty'>No results</div>";
      } catch(e) { /* silent */ }
    }, 250);
  });

  loadTrackResults.addEventListener("click", async e => {
    const item = e.target.closest(".quickadd-item");
    if (!item) return;
    loadTrackModal.style.display = "none";
    const song = await API.get(`/api/songs/${item.dataset.id}`);
    TT.currentTrack = song;
    document.dispatchEvent(new CustomEvent("tt:loadTrack", { detail: song }));
  });

  // ── Import modal ──────────────────────────────────────────────────────────
  const importModal    = document.getElementById("importModal");
  const importClose    = document.getElementById("importClose");
  const importCancelBtn= document.getElementById("importCancelBtn");
  const importSubmitBtn= document.getElementById("importSubmitBtn");
  const importDropZone = document.getElementById("importDropZone");
  const importFile     = document.getElementById("importFile");
  const importProgress = document.getElementById("importProgress");

  let importFileData = null;

  function openImportModal() {
    importFileData = null;
    importFile.value = "";
    importDropZone.querySelector("span").textContent = "Drop audio file here or click to browse";
    importSubmitBtn.disabled = true;
    importProgress.textContent = "";
    importModal.style.display = "flex";
  }

  importClose.addEventListener("click",     () => { importModal.style.display = "none"; });
  importCancelBtn.addEventListener("click", () => { importModal.style.display = "none"; });
  importModal.addEventListener("click", e => {
    if (e.target === importModal) importModal.style.display = "none";
  });

  importDropZone.addEventListener("click", () => importFile.click());
  importDropZone.addEventListener("dragover", e => { e.preventDefault(); importDropZone.classList.add("drag-over"); });
  importDropZone.addEventListener("dragleave", () => importDropZone.classList.remove("drag-over"));
  importDropZone.addEventListener("drop", e => {
    e.preventDefault();
    importDropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  });
  importFile.addEventListener("change", () => {
    if (importFile.files[0]) handleImportFile(importFile.files[0]);
  });

  function handleImportFile(file) {
    importFileData = file;
    importDropZone.querySelector("span").textContent = `✓ ${file.name}  (${(file.size/1024/1024).toFixed(1)} MB)`;
    importSubmitBtn.disabled = false;

    // Try to pre-fill artist / title from filename
    const stem = file.name.replace(/\.[^.]+$/, "");
    const sep = stem.indexOf(" - ");
    if (sep !== -1) {
      document.getElementById("importArtist").value = stem.slice(0, sep).trim();
      document.getElementById("importTitle").value  = stem.slice(sep + 3).trim();
    } else {
      document.getElementById("importTitle").value = stem;
    }
  }

  importSubmitBtn.addEventListener("click", async () => {
    if (!importFileData) return;
    importSubmitBtn.disabled = true;
    importProgress.textContent = "Uploading…";

    const fd = new FormData();
    fd.append("file",       importFileData);
    fd.append("id_subcat",  document.getElementById("importSubcat").value || 1);
    fd.append("id_genre",   document.getElementById("importGenre").value  || 0);
    fd.append("song_type",  document.getElementById("importSongType").value || 0);
    fd.append("artist",     document.getElementById("importArtist").value);
    fd.append("title",      document.getElementById("importTitle").value);

    try {
      const res = await API.postForm("/api/songs/import", fd);
      importProgress.textContent = `✓ Imported as Song #${res.song_id}`;
      toast("Import complete!", "ok");
      setTimeout(() => { importModal.style.display = "none"; doSearch(true); }, 1500);
    } catch(e) {
      importProgress.textContent = "✗ Import failed: " + e.message;
      importSubmitBtn.disabled = false;
      toast("Import failed: " + e.message, "error");
    }
  });

  // ── Initial load — show recent tracks on first open ───────────────────────
  document.addEventListener("tt:panelActive", e => {
    if (e.detail === "panelCrate" && !crateBody.querySelector(".track-row")) {
      doSearch(true);
    }
  });

  // Expose for other modules (e.g., booth search)
  window.CrateSearch = async function(q, limit) {
    const url = `/api/songs?q=${encodeURIComponent(q)}&limit=${limit || 20}`;
    const data = await API.get(url);
    return data.songs ?? data;
  };

  // Do initial load on page start
  doSearch(true);

})();
