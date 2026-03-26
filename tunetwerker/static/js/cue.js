/**
 * cue.js — Cue Editor: WaveSurfer.js waveform + draggable cue markers
 * Cue point format: &sta=X&int=X&hin=X&hou=X&xta=X&end=X&fin=X&fou=X
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function CueEditor() {

  // ── Constants ─────────────────────────────────────────────────────────────
  const CUE_KEYS = ["sta","int","hin","hou","xta","fin","fou","end"];

  const CUE_META = {
    sta: { label:"STA", desc:"Song Start",          colour:"var(--cue-sta)" },
    int: { label:"INT", desc:"Intro End",            colour:"var(--cue-int)" },
    hin: { label:"HIN", desc:"Hook In",              colour:"var(--cue-hin)" },
    hou: { label:"HOU", desc:"Hook Out",             colour:"var(--cue-hou)" },
    xta: { label:"XTA", desc:"Extro Start",          colour:"var(--cue-xta)" },
    fin: { label:"FIN", desc:"Fade In Start",        colour:"var(--cue-fin)" },
    fou: { label:"FOU", desc:"Fade Out End",         colour:"var(--cue-fou)" },
    end: { label:"END", desc:"Song End",             colour:"var(--cue-end)" },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let wavesurfer  = null;
  let currentSong = null;
  let cues        = {};          // { sta: 3.5, int: 12.0, … } — null = not set
  let draggingCue = null;        // key of cue being dragged
  let duration    = 0;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const waveContainer   = document.getElementById("waveform");
  const waveTimeline    = document.getElementById("waveformTimeline");
  const cueMarkersEl    = document.getElementById("cueMarkers");
  const placeholder     = document.getElementById("waveformPlaceholder");

  const metaArtistEl   = document.getElementById("cueMetaArtist");
  const metaTitleEl    = document.getElementById("cueMetaTitle");
  const metaDurEl      = document.getElementById("cueMetaDur");
  const posValEl       = document.getElementById("cuePosVal");

  const playBtn        = document.getElementById("cuePlay");
  const pauseBtn       = document.getElementById("cuePause");
  const stopBtn        = document.getElementById("cueStop");
  const zoomSlider     = document.getElementById("cueZoom");
  const saveCueBtn     = document.getElementById("cueBtnSave");
  const addQueueBtn    = document.getElementById("cueBtnAddQueue");

  // Metadata form
  const mArtist        = document.getElementById("metaArtist");
  const mTitle         = document.getElementById("metaTitle");
  const mAlbum         = document.getElementById("metaAlbum");
  const mYear          = document.getElementById("metaYear");
  const mBpm           = document.getElementById("metaBpm");
  const mGenre         = document.getElementById("metaGenre");
  const mSubcat        = document.getElementById("metaSubcat");
  const mSongType      = document.getElementById("metaSongType");
  const mEnabled       = document.getElementById("metaEnabled");
  const mSaveBtn       = document.getElementById("metaSaveBtn");

  // ── Init WaveSurfer ───────────────────────────────────────────────────────
  function initWaveSurfer() {
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }

    wavesurfer = WaveSurfer.create({
      container:     waveContainer,
      waveColor:     "var(--skin-accent)",
      progressColor: "var(--skin-accent-hover)",
      cursorColor:   "var(--skin-text)",
      cursorWidth:   2,
      height:        90,
      normalize:     true,
      backend:       "WebAudio",
      barWidth:      2,
      barGap:        1,
      interact:      true,
      responsive:    true,
      fillParent:    true,
    });

    wavesurfer.on("ready", () => {
      duration = wavesurfer.getDuration();
      metaDurEl.textContent = fmtDurMs(duration);
      placeholder.style.display = "none";
      renderCueMarkers();
      updateAllCueInputs();
    });

    wavesurfer.on("audioprocess", () => {
      posValEl.textContent = fmtDurMs(wavesurfer.getCurrentTime());
      updateMarkerPositions();
    });

    wavesurfer.on("seek", frac => {
      posValEl.textContent = fmtDurMs(wavesurfer.getCurrentTime());
      updateMarkerPositions();
    });

    wavesurfer.on("error", err => {
      toast("WaveSurfer error: " + err, "error");
    });
  }

  // ── Load a track ─────────────────────────────────────────────────────────
  function loadTrack(song) {
    currentSong = song;
    cues = parseCueTimes(song.cue_times || "");

    metaArtistEl.textContent = song.artist || "—";
    metaTitleEl.textContent  = song.title  || "—";
    metaDurEl.textContent    = fmtDurMs(song.duration || 0);

    // Fill metadata form
    mArtist.value   = song.artist    || "";
    mTitle.value    = song.title     || "";
    mAlbum.value    = song.album     || "";
    mYear.value     = song.year      || "";
    mBpm.value      = song.bpm       || "";
    mEnabled.checked= !song.disabled;
    if (mSongType) mSongType.value = song.song_type ?? 0;

    // Populate genre/subcat selects then set value
    document.addEventListener("tt:lookupsLoaded", () => {
      if (mGenre)  mGenre.value  = song.id_genre   || 0;
      if (mSubcat) mSubcat.value = song.id_subcat  || 0;
    }, { once: true });
    if (TT.genres.length) {
      if (mGenre)  mGenre.value  = song.id_genre  || 0;
      if (mSubcat) mSubcat.value = song.id_subcat || 0;
    }

    // Stream audio through range endpoint for seek support
    const audioUrl = `/audio-range/${song.id}`;

    placeholder.style.display = "flex";
    placeholder.textContent   = "Loading waveform…";
    cueMarkersEl.innerHTML    = "";

    initWaveSurfer();
    wavesurfer.load(audioUrl);
  }

  // ── Parse cue_times string → object ──────────────────────────────────────
  function parseCueTimes(str) {
    const result = {};
    CUE_KEYS.forEach(k => result[k] = null);
    if (!str || str === "&") return result;

    const params = new URLSearchParams(str.startsWith("&") ? str.slice(1) : str);
    CUE_KEYS.forEach(k => {
      const v = params.get(k);
      if (v !== null && v !== "") {
        const num = parseFloat(v);
        if (!isNaN(num) && num >= 0) result[k] = num;
      }
    });
    return result;
  }

  // ── Build cue_times string from cues object ───────────────────────────────
  function buildCueTimes(cueObj) {
    const parts = CUE_KEYS
      .filter(k => cueObj[k] !== null && cueObj[k] !== undefined)
      .map(k => `${k}=${cueObj[k].toFixed(3)}`);
    return parts.length ? "&" + parts.join("&") : "&";
  }

  // ── Render cue markers on the waveform ───────────────────────────────────
  function renderCueMarkers() {
    cueMarkersEl.innerHTML = "";
    if (!duration) return;

    CUE_KEYS.forEach(k => {
      if (cues[k] === null || cues[k] === undefined) return;
      createMarkerEl(k);
    });
  }

  function createMarkerEl(k) {
    const m = CUE_META[k];
    const el = document.createElement("div");
    el.className      = `cue-marker cue-marker-${k}`;
    el.dataset.cue    = k;
    el.title          = `${m.label}: ${m.desc}`;
    el.style.cssText  = `
      position: absolute;
      top: 0; bottom: 0;
      width: 2px;
      background: ${m.colour};
      cursor: ew-resize;
      z-index: 10;
    `;

    // Label flag
    const flag = document.createElement("div");
    flag.style.cssText = `
      position: absolute;
      top: 0;
      left: 2px;
      background: ${m.colour};
      color: #fff;
      font-size: 9px;
      font-weight: bold;
      padding: 1px 3px;
      border-radius: 0 2px 2px 0;
      white-space: nowrap;
      pointer-events: none;
    `;
    flag.textContent = m.label;
    el.appendChild(flag);

    // Drag
    el.addEventListener("mousedown", e => {
      e.stopPropagation();
      draggingCue = k;
    });

    cueMarkersEl.appendChild(el);
    positionMarker(el, cues[k]);
    return el;
  }

  function positionMarker(el, timeSec) {
    if (!duration || timeSec === null) return;
    const pct = Math.max(0, Math.min(1, timeSec / duration)) * 100;
    el.style.left = `${pct}%`;
  }

  function updateMarkerPositions() {
    cueMarkersEl.querySelectorAll(".cue-marker").forEach(el => {
      const k = el.dataset.cue;
      if (cues[k] !== null) positionMarker(el, cues[k]);
    });
  }

  // ── Waveform drag handling ────────────────────────────────────────────────
  cueMarkersEl.addEventListener("mousemove", e => {
    if (!draggingCue || !duration) return;
    const rect = cueMarkersEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t    = frac * duration;
    cues[draggingCue] = parseFloat(t.toFixed(3));
    updateCueInput(draggingCue);
    const markerEl = cueMarkersEl.querySelector(`.cue-marker-${draggingCue}`);
    if (markerEl) positionMarker(markerEl, cues[draggingCue]);
  });

  document.addEventListener("mouseup", () => { draggingCue = null; });

  // ── Cue input update helpers ──────────────────────────────────────────────
  function updateCueInput(k) {
    const inp = document.getElementById(`cp${k.toUpperCase()}_val`);
    if (!inp) return;
    inp.value = cues[k] !== null ? cues[k] : "";
  }

  function updateAllCueInputs() {
    CUE_KEYS.forEach(updateCueInput);
  }

  // ── Cue point button handlers (Set Here / Go To / Clear) ─────────────────
  document.querySelectorAll(".cp-set").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!wavesurfer || !duration) return;
      const k = btn.dataset.cue;
      cues[k] = parseFloat(wavesurfer.getCurrentTime().toFixed(3));
      updateCueInput(k);
      // Ensure marker exists
      let markerEl = cueMarkersEl.querySelector(`.cue-marker-${k}`);
      if (!markerEl) markerEl = createMarkerEl(k);
      positionMarker(markerEl, cues[k]);
    });
  });

  document.querySelectorAll(".cp-goto").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.cue;
      if (!wavesurfer || !duration || cues[k] === null) return;
      wavesurfer.seekTo(cues[k] / duration);
    });
  });

  document.querySelectorAll(".cp-clear").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.cue;
      cues[k] = null;
      updateCueInput(k);
      const markerEl = cueMarkersEl.querySelector(`.cue-marker-${k}`);
      if (markerEl) markerEl.remove();
    });
  });

  // Input field manual edit
  CUE_KEYS.forEach(k => {
    const inp = document.getElementById(`cp${k.toUpperCase()}_val`);
    if (!inp) return;
    inp.addEventListener("change", () => {
      const v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) {
        cues[k] = null;
        inp.value = "";
        const markerEl = cueMarkersEl.querySelector(`.cue-marker-${k}`);
        if (markerEl) markerEl.remove();
      } else {
        cues[k] = v;
        let markerEl = cueMarkersEl.querySelector(`.cue-marker-${k}`);
        if (!markerEl) markerEl = createMarkerEl(k);
        positionMarker(markerEl, cues[k]);
      }
    });
  });

  // ── Transport controls ────────────────────────────────────────────────────
  playBtn.addEventListener("click",  () => { if (wavesurfer) wavesurfer.play(); });
  pauseBtn.addEventListener("click", () => { if (wavesurfer) wavesurfer.pause(); });
  stopBtn.addEventListener("click",  () => {
    if (!wavesurfer) return;
    wavesurfer.stop();
    posValEl.textContent = fmtDurMs(0);
  });

  zoomSlider.addEventListener("input", () => {
    if (!wavesurfer) return;
    wavesurfer.zoom(parseInt(zoomSlider.value));
  });

  // ── Save cues ─────────────────────────────────────────────────────────────
  saveCueBtn.addEventListener("click", async () => {
    if (!currentSong) { toast("No track loaded", "error"); return; }
    // Remove null entries before sending
    const filtered = {};
    CUE_KEYS.forEach(k => { if (cues[k] !== null) filtered[k] = cues[k]; });

    try {
      const res = await API.put(`/api/songs/${currentSong.id}/cue`, { cues: filtered });
      toast("Cues saved ✓", "ok");
      currentSong.cue_times = res.cue_string;
    } catch(e) {
      toast("Save failed: " + e.message, "error");
    }
  });

  // ── Add to queue from cue editor ──────────────────────────────────────────
  addQueueBtn.addEventListener("click", async () => {
    if (!currentSong) { toast("No track loaded", "error"); return; }
    try {
      await API.post(`/api/queue/${currentSong.id}`, {});
      toast(`Queued: ${currentSong.artist} — ${currentSong.title}`, "ok");
      document.dispatchEvent(new Event("tt:queueChanged"));
    } catch(e) {
      toast("Queue add failed: " + e.message, "error");
    }
  });

  // ── Save metadata ─────────────────────────────────────────────────────────
  mSaveBtn.addEventListener("click", async () => {
    if (!currentSong) { toast("No track loaded", "error"); return; }
    const fields = {
      artist:    mArtist.value.trim(),
      title:     mTitle.value.trim(),
      album:     mAlbum.value.trim(),
      year:      parseInt(mYear.value)  || 0,
      bpm:       parseFloat(mBpm.value) || 0,
      id_genre:  parseInt(mGenre.value) || 0,
      id_subcat: parseInt(mSubcat.value)|| 1,
      song_type: parseInt(mSongType.value) ?? 0,
      enabled:   mEnabled.checked ? 1 : 0,
    };
    try {
      await API.put(`/api/songs/${currentSong.id}`, { fields });
      Object.assign(currentSong, fields);
      metaArtistEl.textContent = fields.artist;
      metaTitleEl.textContent  = fields.title;
      toast("Metadata saved ✓", "ok");
    } catch(e) {
      toast("Metadata save failed: " + e.message, "error");
    }
  });

  // ── Listen for external load-track events ────────────────────────────────
  document.addEventListener("tt:loadTrack", e => {
    loadTrack(e.detail);
  });

  // ── Keyboard shortcuts (when Cue panel is active) ─────────────────────────
  document.addEventListener("keydown", e => {
    const panel = document.getElementById("panelCue");
    if (!panel.classList.contains("active")) return;
    if (e.target.tagName === "INPUT") return;

    if (e.code === "Space") {
      e.preventDefault();
      if (wavesurfer) {
        wavesurfer.isPlaying() ? wavesurfer.pause() : wavesurfer.play();
      }
    }
    // Number keys 1-8 = set cue points in order
    const idx = parseInt(e.key) - 1;
    if (idx >= 0 && idx < CUE_KEYS.length && wavesurfer && duration) {
      const k = CUE_KEYS[idx];
      cues[k] = parseFloat(wavesurfer.getCurrentTime().toFixed(3));
      updateCueInput(k);
      let markerEl = cueMarkersEl.querySelector(`.cue-marker-${k}`);
      if (!markerEl) markerEl = createMarkerEl(k);
      positionMarker(markerEl, cues[k]);
    }
  });

})();
