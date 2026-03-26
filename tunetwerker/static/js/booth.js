/**
 * booth.js — The Booth: browser-based voice tracking
 *
 * Signal chain (live, applied before recording):
 *   Mic → High-pass → Low-shelf → Presence (3kHz) → Air (10kHz)
 *       → Compressor → Gain → Analyser → MediaStreamDestination → MediaRecorder
 *
 * Processing is baked into the recorded file — no post-processing needed.
 *
 * StationPlaylist-style overlap:
 *   - VT overlaps OUTRO (xta → end) of previous song
 *   - VT overlaps RAMP  (sta → int) of next song
 *
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Booth() {

  // ══════════════════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════════════════
  let prevSong     = null;
  let nextSong     = null;
  let adjustedXTA  = null;
  let adjustedINT  = null;

  // Audio context + processing nodes
  let audioCtx     = null;
  let micStream    = null;
  let sourceNode   = null;
  let hpFilter     = null;   // high-pass (rumble/pop)
  let lowShelf     = null;   // warmth shelf
  let presence     = null;   // 3kHz presence peak
  let airShelf     = null;   // 10kHz air shelf
  let compressor   = null;   // dynamics compressor
  let gainNode     = null;   // output gain
  let analyserNode = null;   // VU meter source
  let procDest     = null;   // MediaStreamAudioDestinationNode → MediaRecorder

  // Recording
  let mediaRecorder = null;
  let audioChunks   = [];
  let rawBlob       = null;
  let rawBuffer     = null;
  let trimIn        = 0;
  let trimOut       = null;
  let audioBlob     = null;
  let audioUrl      = null;
  let recAudio      = null;
  let recStartTime  = null;
  let recTimerInt   = null;
  let isRecording   = false;
  let vuRafId       = null;

  // Trim canvas
  let trimCanvas   = null;
  let trimCtx2d    = null;
  let trimDragging = null;

  // Timeline drag
  let tlDragging   = null;

  // Current EQ param values (used for UI ↔ nodes)
  const proc = {
    gainDb:    0,
    hpFreq:    80,
    lowGainDb: 0,
    lowFreq:   120,
    presGainDb:0,
    presFreq:  3000,
    presQ:     1.2,
    airGainDb: 0,
    airFreq:   10000,
    compOn:    false,
    compThresh:-24,
    compRatio: 4,
    compAttack:0.003,
    compRelease:0.25,
  };

  // ── EQ Presets ────────────────────────────────────────────────────────────
  const PRESETS = {
    flat: {
      gainDb: 0, hpFreq: 30, lowGainDb: 0, lowFreq: 120,
      presGainDb: 0, presFreq: 3000, presQ: 1.2,
      airGainDb: 0, airFreq: 10000, compOn: false,
      compThresh: -24, compRatio: 4,
    },
    voice: {
      gainDb: 0, hpFreq: 100, lowGainDb: -1, lowFreq: 120,
      presGainDb: 3, presFreq: 3000, presQ: 1.0,
      airGainDb: 2, airFreq: 10000, compOn: false,
      compThresh: -24, compRatio: 4,
      label: "Voice — gentle presence & air boost, rumble removed",
    },
    podcast: {
      gainDb: 3, hpFreq: 120, lowGainDb: 1, lowFreq: 200,
      presGainDb: 4, presFreq: 2800, presQ: 0.9,
      airGainDb: 2, airFreq: 8000, compOn: true,
      compThresh: -20, compRatio: 5,
      label: "Podcast — warm, punchy, light compression",
    },
    radio: {
      gainDb: 6, hpFreq: 120, lowGainDb: -2, lowFreq: 150,
      presGainDb: 6, presFreq: 3200, presQ: 1.4,
      airGainDb: 4, airFreq: 12000, compOn: true,
      compThresh: -18, compRatio: 8,
      label: "Radio Voice — classic on-air tight processing",
    },
    budget: {
      gainDb: 9, hpFreq: 150, lowGainDb: -3, lowFreq: 120,
      presGainDb: 5, presFreq: 2500, presQ: 1.1,
      airGainDb: 3, airFreq: 8000, compOn: true,
      compThresh: -16, compRatio: 6,
      label: "Budget Mic — heavy gain & EQ for bare USB mics",
    },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // DOM REFS
  // ══════════════════════════════════════════════════════════════════════════
  const ctxPrevArtist  = document.getElementById("ctxPrevArtist");
  const ctxPrevTitle   = document.getElementById("ctxPrevTitle");
  const ctxPrevDur     = document.getElementById("ctxPrevDur");
  const ctxPrevXTA     = document.getElementById("ctxPrevXTA");
  const ctxNextArtist  = document.getElementById("ctxNextArtist");
  const ctxNextTitle   = document.getElementById("ctxNextTitle");
  const ctxNextDur     = document.getElementById("ctxNextDur");
  const ctxNextINT     = document.getElementById("ctxNextINT");
  const boothTimeline  = document.getElementById("boothTimeline");
  const btlPrevBar     = document.getElementById("btlPrevBar");
  const btlXtaZone     = document.getElementById("btlXtaZone");
  const btlVTBar       = document.getElementById("btlVTBar");
  const btlNextBar     = document.getElementById("btlNextBar");
  const btlIntZone     = document.getElementById("btlIntZone");
  const boothPrevSearch  = document.getElementById("boothPrevSearch");
  const boothPrevResults = document.getElementById("boothPrevResults");
  const boothNextSearch  = document.getElementById("boothNextSearch");
  const boothNextResults = document.getElementById("boothNextResults");
  const recBtn         = document.getElementById("recBtn");
  const recPlayBtn     = document.getElementById("recPlayBtn");
  const recStopBtn     = document.getElementById("recStopBtn");
  const recTime        = document.getElementById("recTime");
  const recStatus      = document.getElementById("recStatus");
  const recWaveform    = document.getElementById("recWaveform");
  const recVUBar       = document.getElementById("recVUBar");
  const vtTitle        = document.getElementById("vtTitle");
  const vtArtist       = document.getElementById("vtArtist");
  const vtSubcat       = document.getElementById("vtSubcat");
  const recSaveBtn     = document.getElementById("recSaveBtn");
  const recDiscardBtn  = document.getElementById("recDiscardBtn");
  const vtList         = document.getElementById("vtList");

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD PROCESSING UI — injected into .booth-recorder
  // ══════════════════════════════════════════════════════════════════════════
  function buildProcessingUI() {
    const recorder = document.querySelector(".booth-recorder");
    if (!recorder || document.getElementById("procPanel")) return;

    const panel = document.createElement("div");
    panel.id = "procPanel";
    panel.className = "proc-panel";
    panel.innerHTML = `
      <div class="proc-header">
        <span class="proc-title">🎚 MIC PROCESSING</span>
        <div class="proc-preset-row">
          <button class="btn btn-sm proc-preset" data-preset="flat">Flat</button>
          <button class="btn btn-sm proc-preset" data-preset="voice">Voice</button>
          <button class="btn btn-sm proc-preset" data-preset="podcast">Podcast</button>
          <button class="btn btn-sm proc-preset" data-preset="radio">Radio</button>
          <button class="btn btn-sm proc-preset" data-preset="budget">Budget Mic</button>
        </div>
        <button class="btn btn-sm" id="procAdvToggle">⚙ Advanced ▾</button>
      </div>

      <div class="proc-quick-row">
        <!-- GAIN -->
        <div class="proc-knob-group">
          <span class="proc-knob-label">GAIN</span>
          <input type="range" id="procGain" class="proc-slider" min="-12" max="24" step="0.5" value="0">
          <span class="proc-knob-val" id="procGainVal">0 dB</span>
        </div>
        <!-- HP FREQ -->
        <div class="proc-knob-group">
          <span class="proc-knob-label">HP CUT</span>
          <input type="range" id="procHP" class="proc-slider" min="20" max="300" step="5" value="80">
          <span class="proc-knob-val" id="procHPVal">80 Hz</span>
        </div>
        <!-- PRESENCE -->
        <div class="proc-knob-group">
          <span class="proc-knob-label">PRESENCE</span>
          <input type="range" id="procPres" class="proc-slider" min="-6" max="12" step="0.5" value="0">
          <span class="proc-knob-val" id="procPresVal">0 dB</span>
        </div>
        <!-- AIR -->
        <div class="proc-knob-group">
          <span class="proc-knob-label">AIR</span>
          <input type="range" id="procAir" class="proc-slider" min="-6" max="10" step="0.5" value="0">
          <span class="proc-knob-val" id="procAirVal">0 dB</span>
        </div>
        <!-- COMPRESSOR TOGGLE -->
        <div class="proc-knob-group proc-comp-toggle-group">
          <span class="proc-knob-label">PUNCH</span>
          <button class="btn btn-sm proc-comp-btn" id="procCompBtn">OFF</button>
          <span class="proc-knob-val proc-comp-hint">Compress</span>
        </div>
      </div>

      <!-- ADVANCED (collapsed by default) -->
      <div class="proc-advanced" id="procAdvanced" style="display:none">
        <div class="proc-adv-row">
          <div class="proc-knob-group">
            <span class="proc-knob-label">LOW SHELF</span>
            <input type="range" id="procLow" class="proc-slider" min="-8" max="8" step="0.5" value="0">
            <span class="proc-knob-val" id="procLowVal">0 dB</span>
          </div>
          <div class="proc-knob-group">
            <span class="proc-knob-label">PRES FREQ</span>
            <input type="range" id="procPresFreq" class="proc-slider" min="1000" max="6000" step="100" value="3000">
            <span class="proc-knob-val" id="procPresFreqVal">3.0 kHz</span>
          </div>
          <div class="proc-knob-group">
            <span class="proc-knob-label">COMP THRESH</span>
            <input type="range" id="procCompThresh" class="proc-slider" min="-40" max="-6" step="1" value="-24">
            <span class="proc-knob-val" id="procCompThreshVal">-24 dB</span>
          </div>
          <div class="proc-knob-group">
            <span class="proc-knob-label">COMP RATIO</span>
            <input type="range" id="procCompRatio" class="proc-slider" min="1" max="20" step="0.5" value="4">
            <span class="proc-knob-val" id="procCompRatioVal">4:1</span>
          </div>
        </div>
        <div class="proc-bypass-row">
          <button class="btn btn-sm" id="procBypassBtn">Bypass All</button>
          <span class="proc-chain-display" id="procChainDisplay">HP 80Hz · Presence 0dB · Air 0dB · Comp OFF</span>
        </div>
      </div>
    `;

    // Insert before the rec-controls div
    const recControls = recorder.querySelector(".rec-controls");
    if (recControls) recorder.insertBefore(panel, recControls);
    else recorder.prepend(panel);

    bindProcUI();
  }

  // ── Bind processing UI events ─────────────────────────────────────────────
  function bindProcUI() {
    // Presets
    document.querySelectorAll(".proc-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        const p = PRESETS[btn.dataset.preset];
        if (!p) return;
        Object.assign(proc, p);
        syncUIFromProc();
        applyProc();
        document.querySelectorAll(".proc-preset").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Gain
    const gainSlider = document.getElementById("procGain");
    const gainVal    = document.getElementById("procGainVal");
    gainSlider.addEventListener("input", () => {
      proc.gainDb = parseFloat(gainSlider.value);
      gainVal.textContent = `${proc.gainDb >= 0 ? "+" : ""}${proc.gainDb} dB`;
      if (gainNode) gainNode.gain.value = dbToLin(proc.gainDb);
      updateChainDisplay();
    });

    // HP
    const hpSlider = document.getElementById("procHP");
    const hpVal    = document.getElementById("procHPVal");
    hpSlider.addEventListener("input", () => {
      proc.hpFreq = parseFloat(hpSlider.value);
      hpVal.textContent = `${proc.hpFreq} Hz`;
      if (hpFilter) hpFilter.frequency.value = proc.hpFreq;
      updateChainDisplay();
    });

    // Presence boost
    const presSlider = document.getElementById("procPres");
    const presVal    = document.getElementById("procPresVal");
    presSlider.addEventListener("input", () => {
      proc.presGainDb = parseFloat(presSlider.value);
      presVal.textContent = `${proc.presGainDb >= 0 ? "+" : ""}${proc.presGainDb} dB`;
      if (presence) presence.gain.value = proc.presGainDb;
      updateChainDisplay();
    });

    // Air shelf
    const airSlider = document.getElementById("procAir");
    const airVal    = document.getElementById("procAirVal");
    airSlider.addEventListener("input", () => {
      proc.airGainDb = parseFloat(airSlider.value);
      airVal.textContent = `${proc.airGainDb >= 0 ? "+" : ""}${proc.airGainDb} dB`;
      if (airShelf) airShelf.gain.value = proc.airGainDb;
      updateChainDisplay();
    });

    // Compressor toggle
    const compBtn = document.getElementById("procCompBtn");
    compBtn.addEventListener("click", () => {
      proc.compOn = !proc.compOn;
      compBtn.textContent = proc.compOn ? "ON" : "OFF";
      compBtn.classList.toggle("proc-comp-on", proc.compOn);
      applyCompressor();
      updateChainDisplay();
    });

    // Advanced toggle
    document.getElementById("procAdvToggle").addEventListener("click", () => {
      const adv = document.getElementById("procAdvanced");
      const btn = document.getElementById("procAdvToggle");
      const open = adv.style.display === "none";
      adv.style.display = open ? "" : "none";
      btn.textContent = open ? "⚙ Advanced ▴" : "⚙ Advanced ▾";
    });

    // Low shelf
    const lowSlider = document.getElementById("procLow");
    const lowVal    = document.getElementById("procLowVal");
    lowSlider.addEventListener("input", () => {
      proc.lowGainDb = parseFloat(lowSlider.value);
      lowVal.textContent = `${proc.lowGainDb >= 0 ? "+" : ""}${proc.lowGainDb} dB`;
      if (lowShelf) lowShelf.gain.value = proc.lowGainDb;
      updateChainDisplay();
    });

    // Presence freq
    const presFreqSlider  = document.getElementById("procPresFreq");
    const presFreqVal     = document.getElementById("procPresFreqVal");
    presFreqSlider.addEventListener("input", () => {
      proc.presFreq = parseFloat(presFreqSlider.value);
      presFreqVal.textContent = `${(proc.presFreq/1000).toFixed(1)} kHz`;
      if (presence) presence.frequency.value = proc.presFreq;
    });

    // Comp threshold
    const compThreshSlider = document.getElementById("procCompThresh");
    const compThreshVal    = document.getElementById("procCompThreshVal");
    compThreshSlider.addEventListener("input", () => {
      proc.compThresh = parseFloat(compThreshSlider.value);
      compThreshVal.textContent = `${proc.compThresh} dB`;
      if (compressor) compressor.threshold.value = proc.compThresh;
    });

    // Comp ratio
    const compRatioSlider = document.getElementById("procCompRatio");
    const compRatioVal    = document.getElementById("procCompRatioVal");
    compRatioSlider.addEventListener("input", () => {
      proc.compRatio = parseFloat(compRatioSlider.value);
      compRatioVal.textContent = `${proc.compRatio}:1`;
      if (compressor) compressor.ratio.value = proc.compRatio;
    });

    // Bypass
    document.getElementById("procBypassBtn").addEventListener("click", () => {
      Object.assign(proc, PRESETS.flat);
      syncUIFromProc();
      applyProc();
    });

    updateChainDisplay();
  }

  function syncUIFromProc() {
    const setSlider = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setSlider("procGain",       proc.gainDb);
    setSlider("procHP",         proc.hpFreq);
    setSlider("procPres",       proc.presGainDb);
    setSlider("procAir",        proc.airGainDb);
    setSlider("procLow",        proc.lowGainDb);
    setSlider("procPresFreq",   proc.presFreq);
    setSlider("procCompThresh", proc.compThresh);
    setSlider("procCompRatio",  proc.compRatio);

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText("procGainVal",       `${proc.gainDb >= 0 ? "+" : ""}${proc.gainDb} dB`);
    setText("procHPVal",         `${proc.hpFreq} Hz`);
    setText("procPresVal",       `${proc.presGainDb >= 0 ? "+" : ""}${proc.presGainDb} dB`);
    setText("procAirVal",        `${proc.airGainDb >= 0 ? "+" : ""}${proc.airGainDb} dB`);
    setText("procLowVal",        `${proc.lowGainDb >= 0 ? "+" : ""}${proc.lowGainDb} dB`);
    setText("procPresFreqVal",   `${(proc.presFreq/1000).toFixed(1)} kHz`);
    setText("procCompThreshVal", `${proc.compThresh} dB`);
    setText("procCompRatioVal",  `${proc.compRatio}:1`);

    const compBtn = document.getElementById("procCompBtn");
    if (compBtn) {
      compBtn.textContent = proc.compOn ? "ON" : "OFF";
      compBtn.classList.toggle("proc-comp-on", proc.compOn);
    }
  }

  function updateChainDisplay() {
    const el = document.getElementById("procChainDisplay");
    if (!el) return;
    const parts = [
      `HP ${proc.hpFreq}Hz`,
      proc.lowGainDb  !== 0 ? `Low ${proc.lowGainDb >= 0 ? "+" : ""}${proc.lowGainDb}dB` : null,
      proc.presGainDb !== 0 ? `Presence ${proc.presGainDb >= 0 ? "+" : ""}${proc.presGainDb}dB @ ${(proc.presFreq/1000).toFixed(1)}kHz` : null,
      proc.airGainDb  !== 0 ? `Air ${proc.airGainDb >= 0 ? "+" : ""}${proc.airGainDb}dB` : null,
      `Comp ${proc.compOn ? `ON (${proc.compThresh}dB, ${proc.compRatio}:1)` : "OFF"}`,
      proc.gainDb     !== 0 ? `Gain ${proc.gainDb >= 0 ? "+" : ""}${proc.gainDb}dB` : null,
    ].filter(Boolean);
    el.textContent = parts.join("  ·  ");
  }

  // ── dB <→ linear ─────────────────────────────────────────────────────────
  function dbToLin(db) { return Math.pow(10, db / 20); }

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIO PROCESSING CHAIN
  // ══════════════════════════════════════════════════════════════════════════
  async function getMicAndBuildChain() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(e) {
      toast("Microphone access denied: " + e.message, "error");
      return false;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(micStream);

    // ── Build nodes ────────────────────────────────────────────────────────
    hpFilter = audioCtx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = proc.hpFreq;
    hpFilter.Q.value = 0.7;

    lowShelf = audioCtx.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = proc.lowFreq;
    lowShelf.gain.value = proc.lowGainDb;

    presence = audioCtx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = proc.presFreq;
    presence.Q.value = proc.presQ;
    presence.gain.value = proc.presGainDb;

    airShelf = audioCtx.createBiquadFilter();
    airShelf.type = "highshelf";
    airShelf.frequency.value = proc.airFreq;
    airShelf.gain.value = proc.airGainDb;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = proc.compThresh;
    compressor.knee.value      = 6;
    compressor.ratio.value     = proc.compRatio;
    compressor.attack.value    = proc.compAttack;
    compressor.release.value   = proc.compRelease;

    gainNode = audioCtx.createGain();
    gainNode.gain.value = dbToLin(proc.gainDb);

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;

    procDest = audioCtx.createMediaStreamDestination();

    // ── Connect chain ──────────────────────────────────────────────────────
    // sourceNode → hp → lowShelf → presence → air → [compressor if on] → gain → analyser → procDest
    applyProc();

    return true;
  }

  function applyProc() {
    if (!sourceNode) return;

    // Disconnect everything first
    try { sourceNode.disconnect(); } catch(e) {}
    try { hpFilter.disconnect(); }   catch(e) {}
    try { lowShelf.disconnect(); }   catch(e) {}
    try { presence.disconnect(); }   catch(e) {}
    try { airShelf.disconnect(); }   catch(e) {}
    try { compressor.disconnect(); } catch(e) {}
    try { gainNode.disconnect(); }   catch(e) {}
    try { analyserNode.disconnect(); } catch(e) {}

    // Reconnect in order
    let current = sourceNode;
    for (const node of [hpFilter, lowShelf, presence, airShelf]) {
      current.connect(node);
      current = node;
    }
    if (proc.compOn) {
      current.connect(compressor);
      current = compressor;
    }
    current.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(procDest);
    // No connect to audioCtx.destination — avoids mic → speaker feedback
  }

  function applyCompressor() {
    applyProc();  // easiest to just rebuild the chain
  }

  // ── VU meter from analyser ────────────────────────────────────────────────
  function startVUMeter() {
    if (!analyserNode) return;
    const dataArr = new Uint8Array(analyserNode.frequencyBinCount);
    function draw() {
      analyserNode.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
      const pct = Math.min(100, (avg / 128) * 100);
      recVUBar.style.width      = pct + "%";
      recVUBar.style.background = pct > 85 ? "var(--skin-vu-high)"
        : pct > 60 ? "var(--skin-vu-mid)" : "var(--skin-vu-low)";
      vuRafId = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopVUMeter() {
    if (vuRafId) cancelAnimationFrame(vuRafId);
    recVUBar.style.width = "0%";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RECORDING — uses procDest.stream (already processed)
  // ══════════════════════════════════════════════════════════════════════════
  recBtn.addEventListener("click", async () => {
    if (isRecording) stopRecording();
    else await startRecording();
  });

  async function startRecording() {
    // Build the audio chain if not yet done (first record press)
    if (!audioCtx) {
      if (!await getMicAndBuildChain()) return;
      startVUMeter();
    }

    audioChunks = [];
    rawBlob = rawBuffer = audioBlob = audioUrl = null;
    trimIn  = 0; trimOut = null;
    recWaveform.innerHTML = "";

    // Prefer WAV/PCM from procDest if browser supports it; otherwise webm
    const stream = procDest.stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=pcm")
      ? "audio/webm;codecs=pcm"
      : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => finaliseRecording(mimeType);
    mediaRecorder.start(100);

    isRecording = true;
    recStartTime = Date.now();
    recBtn.textContent = "⏹ STOP";
    recBtn.classList.add("recording-pulse");
    recStopBtn.disabled = false;
    recStatus.textContent = "● Recording (processed)…";
    recStatus.style.color = "var(--skin-danger)";

    recTimerInt = setInterval(() => {
      const s = Math.floor((Date.now() - recStartTime) / 1000);
      recTime.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
    }, 500);
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    mediaRecorder.stop();
    isRecording = false;
    clearInterval(recTimerInt);
    recBtn.textContent = "⏺ RECORD";
    recBtn.classList.remove("recording-pulse");
    recStatus.textContent = "Processing…";
    recStatus.style.color = "";
  }

  recStopBtn.addEventListener("click", stopRecording);

  async function finaliseRecording(mimeType) {
    rawBlob = new Blob(audioChunks, { type: mimeType });
    recStatus.textContent = `Ready — ${(rawBlob.size/1024).toFixed(1)} KB`;
    recStatus.style.color = "var(--skin-success)";

    try {
      const tmpCtx = new AudioContext();
      const ab = await rawBlob.arrayBuffer();
      rawBuffer = await tmpCtx.decodeAudioData(ab);
      trimIn    = 0;
      trimOut   = rawBuffer.duration;
      tmpCtx.close();
    } catch(e) {
      console.warn("Decode for trim failed:", e);
      rawBuffer = null;
    }

    drawTrimWaveform();
    buildTrimmedBlob();
    recPlayBtn.disabled = false;
    recSaveBtn.disabled = false;

    if (!vtTitle.value) {
      const now = new Date();
      vtTitle.value = `VT ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    }
    updateTimeline();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRIM WAVEFORM
  // ══════════════════════════════════════════════════════════════════════════
  function drawTrimWaveform() {
    if (!rawBuffer) {
      recWaveform.innerHTML = `<div style="padding:12px;color:var(--skin-text-muted);font-size:11px">Waveform unavailable</div>`;
      return;
    }
    recWaveform.innerHTML = "";

    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:2px 6px;font-size:10px;color:var(--skin-text-muted)";
    labelRow.innerHTML = `<span id="trimInLabel">IN: 0:00.000</span><span style="color:var(--skin-text-secondary);font-size:10px;font-style:italic">drag ▶ IN and ■ OUT handles to trim</span><span id="trimOutLabel">OUT: ${fmtDurMs(rawBuffer.duration)}</span>`;
    recWaveform.appendChild(labelRow);

    trimCanvas = document.createElement("canvas");
    const W = recWaveform.clientWidth || 500;
    trimCanvas.width  = W;
    trimCanvas.height = 72;
    trimCanvas.style.cssText = "width:100%;height:72px;display:block;cursor:crosshair;";
    recWaveform.appendChild(trimCanvas);
    trimCtx2d = trimCanvas.getContext("2d");

    renderTrimCanvas();
    bindTrimDrag();
  }

  function renderTrimCanvas() {
    if (!trimCanvas || !trimCtx2d || !rawBuffer) return;
    const W    = trimCanvas.width;
    const H    = trimCanvas.height;
    const dur  = rawBuffer.duration;
    const data = rawBuffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(data.length / W));
    const amp  = H / 2;
    const inPx = Math.round((trimIn / dur) * W);
    const outPx= Math.round(((trimOut ?? dur) / dur) * W);

    trimCtx2d.clearRect(0, 0, W, H);
    trimCtx2d.fillStyle = "#0d0d0d";
    trimCtx2d.fillRect(0, 0, W, H);

    // Shaded trim-away zones
    trimCtx2d.fillStyle = "rgba(0,0,0,0.55)";
    trimCtx2d.fillRect(0, 0, inPx, H);
    trimCtx2d.fillRect(outPx, 0, W - outPx, H);

    // Waveform
    for (let i = 0; i < W; i++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[i * step + j] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      trimCtx2d.strokeStyle = (i >= inPx && i < outPx)
        ? "var(--skin-accent)" : "rgba(90,90,90,0.5)";
      trimCtx2d.lineWidth   = 1;
      trimCtx2d.beginPath();
      trimCtx2d.moveTo(i + 0.5, amp + min * amp * 0.9);
      trimCtx2d.lineTo(i + 0.5, amp + max * amp * 0.9);
      trimCtx2d.stroke();
    }

    drawTrimHandle(inPx,  H, "in");
    drawTrimHandle(outPx, H, "out");

    const inLbl  = document.getElementById("trimInLabel");
    const outLbl = document.getElementById("trimOutLabel");
    if (inLbl)  inLbl.textContent  = `IN: ${fmtDurMs(trimIn)}`;
    if (outLbl) outLbl.textContent = `OUT: ${fmtDurMs(trimOut ?? dur)}`;
  }

  function drawTrimHandle(x, H, type) {
    const col   = type === "in" ? "#27ae60" : "#c0392b";
    const label = type === "in" ? "▶" : "■";
    trimCtx2d.strokeStyle = col;
    trimCtx2d.lineWidth   = 2;
    trimCtx2d.beginPath();
    trimCtx2d.moveTo(x, 0);
    trimCtx2d.lineTo(x, H);
    trimCtx2d.stroke();
    const tabW = 20, tabH = 16;
    const tabX = type === "in" ? x : x - tabW;
    trimCtx2d.fillStyle = col;
    trimCtx2d.fillRect(tabX, 0, tabW, tabH);
    trimCtx2d.fillStyle = "#fff";
    trimCtx2d.font = "bold 10px sans-serif";
    trimCtx2d.textAlign = "center";
    trimCtx2d.fillText(label, tabX + tabW / 2, 11);
  }

  function bindTrimDrag() {
    trimCanvas.addEventListener("mousedown", e => {
      if (!rawBuffer) return;
      const rect = trimCanvas.getBoundingClientRect();
      const x    = (e.clientX - rect.left) * (trimCanvas.width / rect.width);
      const dur  = rawBuffer.duration;
      const W    = trimCanvas.width;
      const inPx = (trimIn / dur) * W;
      const outPx= ((trimOut ?? dur) / dur) * W;
      const dIn  = Math.abs(x - inPx);
      const dOut = Math.abs(x - outPx);
      if (dIn < 16 || dOut < 16) {
        trimDragging = dIn < dOut ? "in" : "out";
        trimCanvas.style.cursor = "ew-resize";
        e.preventDefault();
      }
    });

    trimCanvas.addEventListener("mousemove", e => {
      if (!rawBuffer) return;
      const rect = trimCanvas.getBoundingClientRect();
      const x    = (e.clientX - rect.left) * (trimCanvas.width / rect.width);
      const dur  = rawBuffer.duration;
      const W    = trimCanvas.width;
      const t    = Math.max(0, Math.min(dur, (x / W) * dur));

      // Hover cursor hint
      if (!trimDragging) {
        const inPx = (trimIn / dur) * W;
        const outPx= ((trimOut ?? dur) / dur) * W;
        trimCanvas.style.cursor = (Math.abs(x - inPx) < 14 || Math.abs(x - outPx) < 14)
          ? "ew-resize" : "crosshair";
        return;
      }

      if (trimDragging === "in") {
        trimIn = parseFloat(Math.min(t, (trimOut ?? dur) - 0.1).toFixed(3));
      } else {
        trimOut = parseFloat(Math.max(t, trimIn + 0.1).toFixed(3));
      }
      renderTrimCanvas();
    });

    document.addEventListener("mouseup", () => {
      if (!trimDragging) return;
      trimDragging = null;
      if (trimCanvas) trimCanvas.style.cursor = "crosshair";
      buildTrimmedBlob();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PCM WAV ENCODER
  // ══════════════════════════════════════════════════════════════════════════
  function encodeWAV(buffer, startSec, endSec) {
    const sr    = buffer.sampleRate;
    const nCh   = buffer.numberOfChannels;
    const sF    = Math.floor(startSec * sr);
    const eF    = Math.ceil((endSec ?? buffer.duration) * sr);
    const fCnt  = Math.max(0, eF - sF);
    const bps   = 2;
    const data  = fCnt * nCh * bps;
    const buf   = new ArrayBuffer(44 + data);
    const v     = new DataView(buf);
    const ws    = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    ws(0, "RIFF"); v.setUint32(4, 36 + data, true);
    ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nCh * bps, true); v.setUint16(32, nCh * bps, true);
    v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, data, true);
    let off = 44;
    for (let i = 0; i < fCnt; i++) {
      for (let ch = 0; ch < nCh; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[sF + i] ?? 0));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  function buildTrimmedBlob() {
    if (!rawBuffer) {
      audioBlob = rawBlob;
      audioUrl  = rawBlob ? URL.createObjectURL(rawBlob) : null;
      return;
    }
    const endSec  = trimOut ?? rawBuffer.duration;
    audioBlob = encodeWAV(rawBuffer, trimIn, endSec);
    audioUrl  = URL.createObjectURL(audioBlob);
    const trimDur = endSec - trimIn;
    recStatus.textContent = `Trimmed: ${fmtDurMs(trimDur)} | ${(audioBlob.size/1024).toFixed(1)} KB WAV`;
    recStatus.style.color = "var(--skin-success)";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PREVIEW / SAVE / DISCARD
  // ══════════════════════════════════════════════════════════════════════════
  recPlayBtn.addEventListener("click", () => {
    if (!audioUrl) return;
    if (recAudio) { recAudio.pause(); recAudio = null; }
    recAudio = new Audio(audioUrl);
    recAudio.play();
    recStatus.textContent = "▶ Playing trimmed preview…";
  });

  recSaveBtn.addEventListener("click", async () => {
    if (!audioBlob) { toast("Nothing recorded yet", "error"); return; }
    if (rawBuffer) buildTrimmedBlob();

    const title    = vtTitle.value.trim()  || "Voice Track";
    const artist   = vtArtist.value.trim() || "Squirrel FM";
    const idSubcat = parseInt(vtSubcat.value) || 1;
    const prevId   = prevSong?.id || 0;
    const nextId   = nextSong?.id || 0;
    const xta  = adjustedXTA ?? (prevSong ? parseCues(prevSong.cue_times).xta ?? null : null);
    const int_ = adjustedINT ?? (nextSong ? parseCues(nextSong.cue_times).int ?? null : null);

    const fd = new FormData();
    fd.append("audio",        audioBlob, "voicetrack.wav");
    fd.append("title",        title);
    fd.append("artist",       artist);
    fd.append("id_subcat",    idSubcat);
    fd.append("prev_song_id", prevId);
    fd.append("next_song_id", nextId);
    if (xta  !== null) fd.append("prev_xta", xta);
    if (int_ !== null) fd.append("next_int", int_);

    recSaveBtn.disabled   = true;
    recStatus.textContent = "Saving…";

    try {
      const res = await API.postForm("/api/voicetrack", fd);
      toast(`Voice track saved — Song #${res.song_id} ✓`, "ok");
      recStatus.textContent = `Saved as Song #${res.song_id}`;
      vtTitle.value = "";
      recPlayBtn.disabled = true;
      recSaveBtn.disabled = true;
      rawBlob = rawBuffer = audioBlob = audioUrl = null;
      trimIn = 0; trimOut = null;
      recWaveform.innerHTML = "";
      recTime.textContent   = "0:00";
      loadVoiceTracks();
    } catch(e) {
      toast("Save failed: " + e.message, "error");
      recStatus.textContent = "Save failed";
      recSaveBtn.disabled = false;
    }
  });

  recDiscardBtn.addEventListener("click", () => {
    if (isRecording) stopRecording();
    rawBlob = rawBuffer = audioBlob = audioUrl = null;
    audioChunks = [];
    trimIn = 0; trimOut = null;
    recWaveform.innerHTML = "";
    recPlayBtn.disabled   = true;
    recSaveBtn.disabled   = true;
    recTime.textContent   = "0:00";
    recStatus.textContent = "Ready";
    recStatus.style.color = "";
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SONG SEARCH DROPDOWNS
  // ══════════════════════════════════════════════════════════════════════════
  function makeSearchDropdown(inputEl, resultsEl, onSelect) {
    let db;
    inputEl.addEventListener("input", () => {
      clearTimeout(db);
      db = setTimeout(async () => {
        const q = inputEl.value.trim();
        if (!q) { resultsEl.innerHTML = ""; return; }
        try {
          const data = await API.get(`/api/songs?q=${encodeURIComponent(q)}&limit=15`);
          const songs = data.songs ?? data;
          resultsEl.innerHTML = songs.map(s =>
            `<div class="booth-result-item" data-id="${s.id}">
              <span class="qa-type ${songTypeClass(s.song_type)}">${songTypeLabel(s.song_type)}</span>
              <span class="qa-artist">${escHtml(s.artist)}</span> –
              <span class="qa-title">${escHtml(s.title)}</span>
              <span class="qa-dur">${fmtDur(s.duration)}</span>
            </div>`
          ).join("") || `<div class="queue-empty">No results</div>`;
          resultsEl.querySelectorAll(".booth-result-item").forEach(item => {
            item.addEventListener("click", async () => {
              const song = await API.get(`/api/songs/${item.dataset.id}`);
              resultsEl.innerHTML = "";
              inputEl.value = `${song.artist} — ${song.title}`;
              onSelect(song);
            });
          });
        } catch(e) { /* silent */ }
      }, 200);
    });
    document.addEventListener("click", e => {
      if (!inputEl.contains(e.target) && !resultsEl.contains(e.target))
        resultsEl.innerHTML = "";
    });
  }

  makeSearchDropdown(boothPrevSearch, boothPrevResults, song => {
    prevSong = song; adjustedXTA = null; updateContext();
  });
  makeSearchDropdown(boothNextSearch, boothNextResults, song => {
    nextSong = song; adjustedINT = null; updateContext();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CONTEXT / TIMELINE
  // ══════════════════════════════════════════════════════════════════════════
  function parseCues(str) {
    const r = {};
    if (!str || str === "&") return r;
    const p = new URLSearchParams(str.startsWith("&") ? str.slice(1) : str);
    ["sta","int","hin","hou","xta","fin","fou","end"].forEach(k => {
      const v = p.get(k); if (v !== null) { const n = parseFloat(v); if (!isNaN(n)) r[k] = n; }
    });
    return r;
  }

  function updateContext() {
    const pc = prevSong ? parseCues(prevSong.cue_times) : {};
    const nc = nextSong ? parseCues(nextSong.cue_times) : {};
    const eXTA = adjustedXTA ?? pc.xta ?? null;
    const eINT = adjustedINT ?? nc.int ?? null;

    if (prevSong) {
      ctxPrevArtist.textContent = prevSong.artist || "—";
      ctxPrevTitle.textContent  = prevSong.title  || "—";
      ctxPrevDur.textContent    = fmtDur(prevSong.duration);
      ctxPrevXTA.textContent    = eXTA !== null
        ? `XTA: ${fmtDurMs(eXTA)} → outro ${fmtDur((prevSong.duration||0) - eXTA)}`
        : "XTA: not set — drag to set";
    } else {
      ctxPrevArtist.textContent = "—"; ctxPrevTitle.textContent = "Select a previous track";
      ctxPrevDur.textContent = ""; ctxPrevXTA.textContent = "XTA: —";
    }
    if (nextSong) {
      ctxNextArtist.textContent = nextSong.artist || "—";
      ctxNextTitle.textContent  = nextSong.title  || "—";
      ctxNextDur.textContent    = fmtDur(nextSong.duration);
      ctxNextINT.textContent    = eINT !== null
        ? `INT: ${fmtDurMs(eINT)} — ramp ${fmtDur(eINT)} instrumental`
        : "INT: not set — drag to set";
    } else {
      ctxNextArtist.textContent = "—"; ctxNextTitle.textContent = "Select a next track";
      ctxNextDur.textContent = ""; ctxNextINT.textContent = "INT: —";
    }
    updateTimeline();
  }

  // XTA/INT handle elements
  const xtaHandle = document.createElement("div");
  xtaHandle.className = "btl-handle btl-handle-xta";
  xtaHandle.title = "Drag to adjust XTA (extro start)";
  btlXtaZone.appendChild(xtaHandle);

  const intHandle = document.createElement("div");
  intHandle.className = "btl-handle btl-handle-int";
  intHandle.title = "Drag to adjust INT (vocal in)";
  btlIntZone.appendChild(intHandle);

  function updateTimeline() {
    if (!prevSong && !nextSong) return;
    const pc = prevSong ? parseCues(prevSong.cue_times) : {};
    const nc = nextSong ? parseCues(nextSong.cue_times) : {};
    const prevDur = prevSong?.duration || 0;
    const nextDur = nextSong?.duration || 0;
    const xta     = adjustedXTA ?? pc.xta ?? (prevDur > 0 ? prevDur * 0.85 : 0);
    const int_    = adjustedINT ?? nc.int ?? (nextDur > 0 ? nextDur * 0.15 : 0);
    const extroLen= prevDur > 0 ? prevDur - xta : 0;
    const vtEst   = rawBuffer ? rawBuffer.duration : 10;
    const total   = Math.max(1, extroLen + vtEst + int_);

    const xtaPct = prevDur > 0 ? Math.max(0, Math.min(100, (extroLen / total) * 100)) : 20;
    btlXtaZone.style.width  = xtaPct + "%";
    btlVTBar.style.width    = Math.max(5, Math.min(80, (vtEst / total) * 100)) + "%";
    const intPct = nextDur > 0 ? Math.max(0, Math.min(100, (int_ / total) * 100)) : 15;
    btlIntZone.style.width  = intPct + "%";

    // Refresh labels
    const pc2 = prevSong ? parseCues(prevSong.cue_times) : {};
    const nc2 = nextSong ? parseCues(nextSong.cue_times) : {};
    if (prevSong && (adjustedXTA ?? pc2.xta) !== null) {
      const eXTA = adjustedXTA ?? pc2.xta;
      ctxPrevXTA.textContent = `XTA: ${fmtDurMs(eXTA)} → outro ${fmtDur((prevSong.duration||0) - eXTA)}`;
    }
    if (nextSong && (adjustedINT ?? nc2.int) !== null) {
      const eINT = adjustedINT ?? nc2.int;
      ctxNextINT.textContent = `INT: ${fmtDurMs(eINT)} — ramp ${fmtDur(eINT)} instrumental`;
    }
  }

  xtaHandle.addEventListener("mousedown", e => { e.stopPropagation(); tlDragging = "xta"; });
  intHandle.addEventListener("mousedown", e => { e.stopPropagation(); tlDragging = "int"; });

  document.addEventListener("mousemove", e => {
    if (!tlDragging) return;
    if (tlDragging === "xta" && prevSong) {
      const rect = btlPrevBar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const d = prevSong.duration || 1;
      adjustedXTA = parseFloat(Math.max(d * 0.4, Math.min(d - 0.5, frac * d)).toFixed(3));
      updateTimeline();
    }
    if (tlDragging === "int" && nextSong) {
      const rect = btlNextBar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const d = nextSong.duration || 1;
      adjustedINT = parseFloat(Math.max(0.5, Math.min(d * 0.5, frac * d)).toFixed(3));
      updateTimeline();
    }
  });

  document.addEventListener("mouseup", () => {
    if (!tlDragging) return;
    tlDragging = null;
    if (adjustedXTA !== null || adjustedINT !== null) showCueSavePrompt();
  });

  function showCueSavePrompt() {
    if (document.getElementById("btlSavePrompt")) return;
    const p = document.createElement("div");
    p.id = "btlSavePrompt";
    p.style.cssText = "display:flex;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--skin-border);background:var(--skin-bg-secondary);font-size:11px;color:var(--skin-text-secondary);flex-shrink:0";
    p.innerHTML = `<span>Cue adjusted. Save back to track?</span>
      <button class="btn btn-sm btn-primary" id="btlSavePrevCue">Save XTA →</button>
      <button class="btn btn-sm btn-primary" id="btlSaveNextCue">← Save INT</button>
      <button class="btn btn-sm" id="btlDismissPrompt">Keep local</button>`;
    boothTimeline.parentElement.appendChild(p);
    document.getElementById("btlSavePrevCue").addEventListener("click", async () => {
      if (prevSong && adjustedXTA !== null) { await saveCueBack(prevSong, "xta", adjustedXTA); p.remove(); }
    });
    document.getElementById("btlSaveNextCue").addEventListener("click", async () => {
      if (nextSong && adjustedINT !== null) { await saveCueBack(nextSong, "int", adjustedINT); p.remove(); }
    });
    document.getElementById("btlDismissPrompt").addEventListener("click", () => p.remove());
  }

  async function saveCueBack(song, key, val) {
    try {
      const ex = parseCues(song.cue_times || "");
      ex[key] = val;
      const cues = {};
      ["sta","int","hin","hou","xta","fin","fou","end"].forEach(k => { if (ex[k] !== undefined) cues[k] = ex[k]; });
      await API.put(`/api/songs/${song.id}/cue`, { cues });
      song.cue_times = "&" + Object.entries(cues).map(([k,v]) => `${k}=${v.toFixed(3)}`).join("&");
      toast(`${key.toUpperCase()} saved for "${song.title}" ✓`, "ok");
    } catch(e) {
      toast("Cue save failed: " + e.message, "error");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE TRACK LIBRARY
  // ══════════════════════════════════════════════════════════════════════════
  async function loadVoiceTracks() {
    try {
      const tracks = await API.get("/api/voicetracks");
      if (!tracks.length) {
        vtList.innerHTML = `<div class="queue-empty">No voice tracks saved yet.</div>`; return;
      }
      vtList.innerHTML = tracks.map(t => `
        <div class="vt-item queue-item" data-id="${t.id}">
          <div class="queue-info">
            <span class="queue-artist">${escHtml(t.artist||"")}</span>
            <span class="queue-title">${escHtml(t.title||"—")}</span>
          </div>
          <span class="queue-dur">${fmtDur(t.duration)}</span>
          <button class="btn btn-sm btn-icon" data-action="queue" data-id="${t.id}" title="Add to Queue">+</button>
          <button class="btn btn-sm btn-icon" data-action="cue" data-id="${t.id}" title="Edit Cues">✂️</button>
        </div>`).join("");
      vtList.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          if (btn.dataset.action === "queue") {
            await API.post(`/api/queue/${id}`, {});
            toast("Voice track queued ✓", "ok");
            document.dispatchEvent(new Event("tt:queueChanged"));
          } else {
            const song = await API.get(`/api/songs/${id}`);
            document.dispatchEvent(new CustomEvent("tt:loadTrack", { detail: song }));
            document.querySelector('[data-panel="panelCue"]').click();
          }
        });
      });
    } catch(e) { console.warn("VT list load failed:", e); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════
  document.addEventListener("tt:panelActive", e => {
    if (e.detail === "panelBooth") {
      buildProcessingUI();   // idempotent — only builds once
      loadVoiceTracks();
      updateContext();
    }
  });

  document.addEventListener("tt:lookupsLoaded", () => {
    if (TT.categories.length && vtSubcat) vtSubcat.value = TT.categories[0]?.id_subcat || 0;
  });

  loadVoiceTracks();

})();
