# Squirrel FM Software Suite — Session Notes
**Cross-reference: squirrel-fm-suite-master-spec-v02.docx**
**Updated: 26 March 2026**

---

## The Four Apps (from master spec)

| App | Tagline | What It Is |
|-----|---------|------------|
| **TUNE/TWERKER** | Ya gotta shake it ta make it | Web-based radio playout system. The hub. |
| **STEAMING STREAM** | Spraying your stuff everywhere | Multi-bitrate encoder. RadioCaster replacement. **Built. Bugs being fixed.** |
| **SPLATTER FOR YOUR PATTER** | Putting crap in the gaps | AI-powered radio imaging sound effect generator (AudioCraft/AudioGen, local, no internet after model download). |
| **SMART CARTS** | Calling all button pushers | Standalone cartwall. **Next build.** |

---

## What "music management tool for TUNE/TWERKER + RadioDJ" actually means

The user asked about this before sharing the master spec. It maps to:

- **The Crate** (T/T music library section) — browse, import, edit, bulk manage audio assets
- **The Import Dock** (T/T import tools) — RadioDJ migration: track library, rotation categories, play history. **Must build against current RadioDJ schema v2.0.4.7.**
- Also: StationPlaylist import where parseable

Screenshots of TUNE/TWERKER interface to be provided when user is home — needed to map field layouts.

---

## SMART CARTS — Next Build Notes

From spec (Part E):
- Standalone cartwall, also docks into T/T as plugin
- Audio preloaded into memory, zero-delay fire
- Per-cart: file path, label, colour, volume trim (-12/+12dB), fade in/out (ms), cue point, outro point, play mode (once/loop/hold)
- Cart banks: named grids (2x4, 4x4, 4x8, custom), touch-responsive
- **Standalone mode:** local SQLite (schema mirrors T/T fields for migration compatibility)
- **RadioDJ import:** file paths, labels, cue points, intro/outro trim, gain — build against RadioDJ schema v2.0.4.7
- **T/T plugin mode:** port 7703, JSON over TCP
- Runs in browser or as PyQt6 app

### RadioDJ → SMART CARTS field mapping (to confirm)
| RadioDJ field | SMART CARTS field |
|---------------|-------------------|
| songs.path | File path |
| songs.artist + songs.title | Label |
| cue_times sta= | Cue point (ms) |
| cue_times end= | Outro point (ms) |
| cue_times fin= | Fade in (ms) |
| cue_times fou= | Fade out (ms) |
| songs.loudness / bs1770 | Volume trim |
| carts_list.color | Colour |

---

## Stack Summary (from master spec)

- **T/T backend:** Liquidsoap + PHP web interface + MariaDB
- **Satellite apps:** Python + PyQt6 (standalone), browser plugin mode via TCP/JSON
- **Shared:** skin_engine.py, plugin_server.py/client.py, vumeter.py, cart_engine.py
- **Platform:** Windows + Linux only. macOS: GFY Protocol (permanent, non-negotiable)
- **License:** GPL v3, all four apps. GPG signed. No telemetry. No ads. Ever.
- **Security:** SNAPSMACK signing key, dedicated air-gapped build machine
- **Mascot:** Miley the twerking squirrel (T/T). Lobster in a hot tub (STEAMING STREAM).

---

## SPLATTER — Save to Library Flow

When a generated effect is approved:

- **T/T mode** → writes file to asset folder, inserts into Drop Deck / Station IDs / The Crate DB immediately. No rescan.
- **RadioDJ mode** → writes file to library path, inserts row into `songs` (`song_type`=1 Jingle/ID, user-selectable `id_subcat`, `cue_times` defaults to `&`, `end` auto-set to file duration)
- **Standalone** → saves to configured output folder, optionally logs to SMART CARTS SQLite

### File naming convention (to avoid collisions)
`splatter_[timestamp]_[category].wav`
e.g. `splatter_20260323_143022_sweeper.wav`

### RadioDJ insert fields at save time
| Field | Value |
|-------|-------|
| path | Output file path |
| song_type | 1 (Jingle/ID) — user can override |
| id_subcat | User-selectable at save dialog |
| cue_times | `&` (default — no cues yet) |
| duration / original_duration | Auto-read from generated file |
| artist | `SPLATTER` or user-defined station name |
| title | User-entered at save time |
| enabled | 1 |
| loudness | 1.00 (default until measured) |

---

## SPLATTER — Runtime Architecture

**Key principle: server serves the app, client runs the AI. Playout system is never involved.**

- **Server** — serves SPLATTER web app only (Flask/FastAPI + static files). Lightweight. No inference, no audio.
- **Client** — runs a local helper process (Python) on the workstation. Handles AudioCraft inference, temp cache, waveform preview, file I/O, and save-to-library. Registers with the browser page via localhost.
- **Browser** — UI only. Talks to local helper (localhost) for generation. Talks to server only for save instruction when effect is approved.
- **Server never sees audio data.** Just receives the approved save instruction.

### Client helper lifecycle
- Starts once on the workstation (one-time Python + AudioCraft install)
- Model loads into RAM/VRAM on first generation request (lazy load)
- Stays loaded while SPLATTER is open
- On close: prompt to wipe temp cache or keep session. Model unloads. Temp folder evaporates.
- Inference is bursty (seconds at a time), not sustained — no impact on anything else running

### Client install
- One-time setup: Python + AudioCraft — fits GPL/open source self-install ethos
- PyInstaller bundle option for Windows users who don't want raw Python

### Scheduling guard (single-machine setups)
- Optional: disable generation during configured peak broadcast hours
- Time-based lock in local helper config

---

## Build Order

1. **TUNE/TWERKER — core build** ← **COMPLETED overnight 25→26 March 2026**
2. **Import / Library Management Tool** ← awaiting assets/screenshots from user
3. **SPLATTER FOR YOUR PATTER — standalone** ← after import tool
4. **SPLATTER — T/T integrated**
5. SMART CARTS

---

## TUNE/TWERKER Build Status (as of 26 March 2026)

**Backend — COMPLETE**
- `config.json` — DB, server, library path_map, liquidsoap telnet config
- `requirements.txt` — fastapi, uvicorn, pymysql, python-multipart, aiofiles, mutagen
- `db.py` — Full RadioDJ DB layer (all queries, cue_times parse/build, path translation)
- `liquidsoap.py` — LiquidsoapClient (telnet), generate_liquidsoap_script()
- `server.py` — FastAPI app, all endpoints (audio serve + range, songs CRUD, cue save, import, queue, carts, lookups, history, voice track, liq control, settings)

**Frontend — COMPLETE**
- `static/skins/default/skin.css` — CSS variables (colours, cue point colours)
- `static/app.css` — Full CSS (1550 lines) covering all panels and new layout layer
- `static/index.html` — Full SPA shell: topbar, nav, all 6 panels, import modal, load-track modal
- `static/js/main.js` — Bootstrap, API layer, nav, Liquidsoap polling, toast notifications, lookup loader
- `static/js/clock.js` — Analogue + digital studio clock (canvas, smooth 50ms tick)
- `static/js/crate.js` — Library browser: search/filter/paginate, import modal, load-to-cue, quick-add
- `static/js/cue.js` — WaveSurfer.js waveform + 8 draggable cue markers (STA/INT/HIN/HOU/XTA/FIN/FOU/END), keyboard shortcuts (Space=play/pause, 1-8=set cues), metadata editor, save to DB
- `static/js/queue.js` — On Air display, queue drag-to-reorder, VU meters (simulated), Quick Add, Liquidsoap now-playing
- `static/js/booth.js` — Voice tracking: MediaRecorder, mic VU meter via AudioContext/AnalyserNode, recording waveform canvas, StationPlaylist-style overlap timeline (XTA→END overlap prev, STA→INT overlap next), save to DB
- `static/js/wall.js` — Cart wall: cart banks, 8×4 grid, Web Audio cart playback, progress bars, F1-F12 shortcuts
- `static/js/log.js` — History viewer with search and pagination

**Key design decisions recorded:**
- WaveSurfer.js 7 via unpkg CDN
- `/audio-range/{id}` endpoint for seek-capable waveform loading
- Cue markers are absolutely positioned divs on `.cue-markers` overlay; draggable via mousedown/mousemove on the overlay div
- Voice tracks saved as browser-native format (webm/ogg) since WAV encoder not available in MediaRecorder without external lib; server accepts any format
- Liquidsoap polling every 4s; now-playing parsed from "Artist - Title" string
- VU meters on On Air panel are cosmetically animated (real metering would need server-side audio analysis)

**To start the server:**
```bash
cd tunetwerker
pip install -r requirements.txt
python server.py
```
Then open `http://localhost:8080` (or configured port) in any browser.

---

## Pending / Waiting On User

- [ ] Screenshots / assets for Import & Library Management tool
- [ ] Any additional SPLATTER UI reference material
- [ ] Test TUNE/TWERKER against live RadioDJ DB — may need minor query adjustments
- [ ] Confirm voice track format acceptable or add ffmpeg WAV conversion on server side
