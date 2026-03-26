/**
 * queue.js — On Air / Queue panel + Quick Add
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Queue() {

  // ── State ─────────────────────────────────────────────────────────────────
  let queue        = [];
  let nowPlaying   = null;
  let onAirStart   = null;   // Date when current track started
  let onAirTimer   = null;
  let dragging     = null;   // drag-and-drop queue item

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const onairArtist   = document.getElementById("onairArtist");
  const onairTitle    = document.getElementById("onairTitle");
  const onairAlbum    = document.getElementById("onairAlbum");
  const onairProgress = document.getElementById("onairProgress");
  const onairElapsed  = document.getElementById("onairElapsed");
  const onairRemain   = document.getElementById("onairRemain");
  const queueList     = document.getElementById("queueList");
  const queueClearBtn = document.getElementById("queueClearBtn");
  const queueETA      = document.getElementById("queueETA");
  const quickSearch   = document.getElementById("quickSearch");
  const quickSearchBtn= document.getElementById("quickSearchBtn");
  const quickResults  = document.getElementById("quickResults");

  // ── Load queue from server ────────────────────────────────────────────────
  async function loadQueue() {
    try {
      const data = await API.get("/api/queue");
      queue = data;
      renderQueue();
    } catch(e) {
      console.warn("Queue load failed:", e);
    }
  }

  // ── Render queue list ─────────────────────────────────────────────────────
  function renderQueue() {
    if (!queue.length) {
      queueList.innerHTML = `<div class="queue-empty">Queue is empty</div>`;
      queueETA.textContent = "ETA: —";
      return;
    }

    let totalSecs = 0;
    queueList.innerHTML = queue.map((item, idx) => {
      totalSecs += item.duration || 0;
      const dur = fmtDur(item.duration);
      const typeCls = songTypeClass(item.song_type ?? 0);
      return `
        <div class="queue-item" data-qid="${item.queue_id}" draggable="true">
          <span class="queue-pos">${idx + 1}</span>
          <span class="queue-type-dot ${typeCls}"></span>
          <div class="queue-info">
            <span class="queue-artist">${escHtml(item.artist || "—")}</span>
            <span class="queue-title">${escHtml(item.title || "—")}</span>
          </div>
          <span class="queue-dur">${dur}</span>
          <button class="btn btn-sm btn-icon queue-remove" data-qid="${item.queue_id}" title="Remove">✕</button>
        </div>`;
    }).join("");

    // ETA
    queueETA.textContent = `ETA: ${fmtDur(totalSecs)} total`;

    // Bind remove buttons
    queueList.querySelectorAll(".queue-remove").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const qid = parseInt(btn.dataset.qid);
        await removeFromQueue(qid);
      });
    });

    // Drag-to-reorder
    initDragToReorder();
  }

  async function removeFromQueue(qid) {
    try {
      await API.del(`/api/queue/${qid}`);
      queue = queue.filter(q => q.queue_id !== qid);
      renderQueue();
    } catch(e) {
      toast("Remove failed: " + e.message, "error");
    }
  }

  // ── Drag to reorder ───────────────────────────────────────────────────────
  function initDragToReorder() {
    const items = queueList.querySelectorAll(".queue-item");
    items.forEach(item => {
      item.addEventListener("dragstart", e => {
        dragging = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragend", () => {
        dragging = null;
        item.classList.remove("dragging");
        items.forEach(i => i.classList.remove("drag-over"));
        saveReorder();
      });
      item.addEventListener("dragover", e => {
        e.preventDefault();
        if (item !== dragging) {
          items.forEach(i => i.classList.remove("drag-over"));
          item.classList.add("drag-over");
        }
      });
      item.addEventListener("drop", e => {
        e.preventDefault();
        if (dragging && item !== dragging) {
          const allItems = [...queueList.querySelectorAll(".queue-item")];
          const fromIdx  = allItems.indexOf(dragging);
          const toIdx    = allItems.indexOf(item);
          if (fromIdx < toIdx) {
            item.after(dragging);
          } else {
            item.before(dragging);
          }
        }
      });
    });
  }

  async function saveReorder() {
    const ids = [...queueList.querySelectorAll(".queue-item")]
      .map(el => parseInt(el.dataset.qid));
    try {
      await API.put("/api/queue/reorder", { ids });
      await loadQueue();
    } catch(e) {
      console.warn("Reorder failed:", e);
    }
  }

  // ── Clear queue ───────────────────────────────────────────────────────────
  queueClearBtn.addEventListener("click", async () => {
    if (!confirm("Clear the entire queue?")) return;
    try {
      await API.del("/api/queue");
      queue = [];
      renderQueue();
    } catch(e) {
      toast("Clear failed: " + e.message, "error");
    }
  });

  // ── On-Air display ─────────────────────────────────────────────────────────
  function updateOnAirDisplay(song, elapsed) {
    if (!song) {
      onairArtist.textContent = "—";
      onairTitle.textContent  = "Not connected";
      onairAlbum.textContent  = "";
      onairProgress.style.width = "0%";
      onairElapsed.textContent = "0:00";
      onairRemain.textContent  = "-0:00";
      return;
    }

    onairArtist.textContent = song.artist || "—";
    onairTitle.textContent  = song.title  || "—";
    onairAlbum.textContent  = song.album  || "";

    const dur = song.duration || 0;
    if (dur > 0 && elapsed >= 0) {
      const pct = Math.min(100, (elapsed / dur) * 100);
      onairProgress.style.width = `${pct}%`;
      onairElapsed.textContent  = fmtDur(elapsed);
      onairRemain.textContent   = "-" + fmtDur(Math.max(0, dur - elapsed));
    }

    // Update topbar too
    document.getElementById("npArtist").textContent = song.artist || "";
    document.getElementById("npTitle").textContent  = song.title  || "—";
  }

  // Tick the on-air progress
  function tickOnAir() {
    if (!nowPlaying || !onAirStart) return;
    const elapsed = (Date.now() - onAirStart) / 1000;
    updateOnAirDisplay(nowPlaying, elapsed);
    const dur = nowPlaying.duration || 0;
    const pct = dur > 0 ? Math.min(100, (elapsed / dur) * 100) : 0;
    document.getElementById("npProgressBar").style.width = pct + "%";
  }

  // ── Quick Add (On Air panel) ──────────────────────────────────────────────
  let qaDebounce;
  quickSearch.addEventListener("input", () => {
    clearTimeout(qaDebounce);
    qaDebounce = setTimeout(() => doQuickSearch(quickSearch.value), 200);
  });
  quickSearchBtn.addEventListener("click", () => doQuickSearch(quickSearch.value));
  quickSearch.addEventListener("keydown", e => {
    if (e.key === "Enter") doQuickSearch(quickSearch.value);
  });

  async function doQuickSearch(q) {
    if (!q.trim()) { quickResults.innerHTML = ""; return; }
    try {
      const data = await API.get(`/api/songs?q=${encodeURIComponent(q.trim())}&limit=20`);
      const songs = data.songs ?? data;
      if (!songs.length) {
        quickResults.innerHTML = `<div class="queue-empty">No results</div>`;
        return;
      }
      quickResults.innerHTML = songs.map(s => `
        <div class="quickadd-item" data-id="${s.id}">
          <span class="qa-type ${songTypeClass(s.song_type)}">${songTypeLabel(s.song_type)}</span>
          <span class="qa-artist">${escHtml(s.artist)}</span>
          <span class="qa-sep">–</span>
          <span class="qa-title">${escHtml(s.title)}</span>
          <span class="qa-dur">${fmtDur(s.duration)}</span>
          <button class="btn btn-sm qa-add" data-id="${s.id}">+</button>
        </div>`).join("");

      quickResults.querySelectorAll(".qa-add").forEach(btn => {
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          await addSongToQueue(parseInt(btn.dataset.id));
        });
      });
    } catch(e) {
      toast("Search failed: " + e.message, "error");
    }
  }

  async function addSongToQueue(songId) {
    try {
      await API.post(`/api/queue/${songId}`, {});
      toast("Added to queue ✓", "ok");
      await loadQueue();
    } catch(e) {
      toast("Queue add failed: " + e.message, "error");
    }
  }

  // ── VU meter simulation (cosmetic — real levels need AudioContext) ─────────
  let vuInterval;
  function startVUMeter() {
    const vuL = document.getElementById("vuL");
    const vuR = document.getElementById("vuR");
    if (!vuL || !vuR) return;

    // Animate simulated VU bars when something is on air
    vuInterval = setInterval(() => {
      if (nowPlaying) {
        const l = 30 + Math.random() * 65;
        const r = 30 + Math.random() * 65;
        vuL.style.height = l + "%";
        vuR.style.height = r + "%";
        // Colour based on level
        const lCol = l > 90 ? "var(--skin-vu-high)" : l > 70 ? "var(--skin-vu-mid)" : "var(--skin-vu-low)";
        const rCol = r > 90 ? "var(--skin-vu-high)" : r > 70 ? "var(--skin-vu-mid)" : "var(--skin-vu-low)";
        vuL.style.background = lCol;
        vuR.style.background = rCol;
      } else {
        vuL.style.height = "2%";
        vuR.style.height = "2%";
      }
    }, 80);
  }

  // ── Panel activation — refresh queue when panel shown ────────────────────
  document.addEventListener("tt:panelActive", e => {
    if (e.detail === "panelOnAir") {
      loadQueue();
    }
  });

  // ── Queue changed from other modules ─────────────────────────────────────
  document.addEventListener("tt:queueChanged", loadQueue);

  // ── On-air status via Liquidsoap polling (forwarded from main.js) ─────────
  // We hook into the existing poll by reading liq status directly
  async function refreshOnAir() {
    try {
      const data = await API.get("/api/liquidsoap/status");
      if (data.connected && data.now_playing) {
        // Try to find the song in DB by parsing "Artist - Title"
        // For now update the display with the string
        const npStr = data.now_playing;
        if (!nowPlaying || nowPlaying._raw !== npStr) {
          nowPlaying = { _raw: npStr, artist: "", title: npStr, duration: 0 };
          if (npStr.includes(" - ")) {
            const i = npStr.indexOf(" - ");
            nowPlaying.artist = npStr.slice(0, i).trim();
            nowPlaying.title  = npStr.slice(i + 3).trim();
          }
          onAirStart = Date.now();
          updateOnAirDisplay(nowPlaying, 0);
        }
      } else if (!data.connected) {
        nowPlaying = null;
        updateOnAirDisplay(null, 0);
      }
    } catch(e) { /* silent */ }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadQueue();
  startVUMeter();

  // Tick the elapsed timer
  setInterval(tickOnAir, 500);

  // Poll on-air status at same rate as main.js
  setInterval(refreshOnAir, TT.POLL_MS);
  refreshOnAir();

})();
