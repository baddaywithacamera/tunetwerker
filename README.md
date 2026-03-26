# 🐿 TUNE/TWERKER
### *Ya gotta shake it ta make it*

Part of the **Squirrel FM Software Suite** — open-source radio automation for hobbyist internet broadcasters.

**License:** GPL v3 | **Platform:** Windows + Linux | **macOS:** GFY Protocol (permanent, non-negotiable)

---

## The Suite

| App | Status | Description |
|-----|--------|-------------|
| **TUNE/TWERKER** | 🚧 In development | Web-based radio playout system. The hub. |
| **STEAMING STREAM** | ✅ [Own repo](https://github.com/baddaywithacamera/steaming-stream) | Multi-bitrate encoder. RadioCaster replacement. |
| **SPLATTER FOR YOUR PATTER** | 📋 Planned | AI radio imaging generator (AudioCraft, runs local). |
| **SMART CARTS** | 📋 Planned | Standalone cartwall with T/T plugin mode. |

---

## TUNE/TWERKER

A browser-based radio playout system. Runs as a FastAPI server; open in any browser on your LAN — no client software to install.

Compatible with existing **RadioDJ v2.0.4.7** databases. Keep your cue data, categories, rotation, history — everything carries over.

### Features
- **The Crate** — library browser, search, filter, drag-to-cue, audio import
- **Cue Editor** — WaveSurfer.js waveform, 8 draggable cue points (STA/INT/HIN/HOU/XTA/FIN/FOU/END), keyboard shortcuts
- **On Air / Queue** — live now-playing, drag-to-reorder queue, quick-add search, VU meters
- **The Booth** — browser voice tracking with Web Audio mic processing chain (gain, EQ, compressor, presets), trim handles, StationPlaylist-style overlap timeline with draggable XTA/INT handles
- **The Wall** — cart player, bank tabs, F1–F12 hotkeys
- **The Log** — searchable playout history
- **Studio Clock** — analogue + digital, smooth sweep second hand
- **Liquidsoap integration** — telnet control, skip, volume, now-playing

### Stack
- **Backend:** Python 3.10+ / FastAPI / PyMySQL / Liquidsoap (telnet)
- **Frontend:** Vanilla JS (no framework) / WaveSurfer.js / Web Audio API
- **Database:** MariaDB — RadioDJ v2.0.4.7 schema (MyISAM, utf8mb4)
- **Playout engine:** Liquidsoap

---

## Quick Start

```bash
cd tunetwerker
cp config.sample.json config.json
# Edit config.json — set your DB credentials, library path, Liquidsoap host
pip install -r requirements.txt
python server.py
# Open http://your-server:7700 in any browser
```

### Requirements
- Python 3.10+
- MariaDB with RadioDJ v2.0.4.7 database
- Liquidsoap (for playout control — T/T will run without it, control features disabled)

---

## Skins

Drop a folder under `tunetwerker/static/skins/` with a `skin.css` defining the CSS variables from `skins/default/skin.css`. Skin name = folder name.

---

## Plugin Architecture

Satellite apps connect to T/T via JSON over TCP:
- Port **7701** — SMART CARTS
- Port **7702** — SPLATTER FOR YOUR PATTER  
- Port **7703** — reserved

---

## RadioDJ Compatibility

T/T reads and writes the RadioDJ v2.0.4.7 database directly. Cue times use RadioDJ's native format:
```
&sta=X&int=X&hin=X&hou=X&xta=X&end=X&fin=X&fou=X
```
No migration required if you're already on v2.0.4.7. See `radiodj_schema_2.0.4.7.sql` for schema reference.

---

## Contributing

GPL v3. Fork it, improve it, send a PR. No telemetry. No ads. Ever.

---

*Squirrel FM has been online and licensed since 2018.*
