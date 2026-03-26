"""
server.py — TUNE/TWERKER FastAPI backend
Squirrel FM playout system — GPL v3 — No ads. Ever.
"""
import json, os, mimetypes, asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles
from mutagen import File as MutagenFile
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4

import db
from liquidsoap import liq, generate_liquidsoap_script

_cfg = json.loads(Path("config.json").read_text())
_lib = _cfg["library"]
Path(_lib["voice_track_dir"]).mkdir(parents=True, exist_ok=True)
Path(_lib["temp_dir"]).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="TUNE/TWERKER", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# ── Static files ──────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

# ── Audio file serving with range request support ────────────────────────────

@app.get("/audio/{song_id}")
async def serve_audio(song_id: int):
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    local = song["local_path"]
    if not Path(local).exists():
        raise HTTPException(404, f"File not found: {local}")
    mime, _ = mimetypes.guess_type(local)
    mime = mime or "audio/mpeg"
    return FileResponse(local, media_type=mime,
                        headers={"Accept-Ranges": "bytes"})

@app.get("/audio-range/{song_id}")
async def serve_audio_range(song_id: int,
                             request_range: Optional[str] = None):
    """Range-request aware audio serving for WaveSurfer seeking."""
    from fastapi import Request
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(404)
    local = Path(song["local_path"])
    if not local.exists():
        raise HTTPException(404)

    file_size = local.stat().st_size
    mime, _ = mimetypes.guess_type(str(local))
    mime = mime or "audio/mpeg"

    async def file_sender(start: int, end: int):
        async with aiofiles.open(local, "rb") as f:
            await f.seek(start)
            remaining = end - start + 1
            chunk_size = 65536
            while remaining > 0:
                chunk = await f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                yield chunk
                remaining -= len(chunk)

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": mime,
    }
    return StreamingResponse(
        file_sender(0, file_size - 1),
        status_code=200,
        headers=headers,
        media_type=mime,
    )

# ── Library / Crate ──────────────────────────────────────────────────────────

@app.get("/api/songs")
async def api_songs(
    q: str = "", subcat: int = 0, genre: int = 0,
    song_type: int = -1, enabled_only: bool = False,
    limit: int = 100, offset: int = 0
):
    return db.search_songs(q, subcat, genre, song_type, enabled_only, limit, offset)

@app.get("/api/songs/{song_id}")
async def api_song(song_id: int):
    s = db.get_song(song_id)
    if not s:
        raise HTTPException(404)
    return s

class SongMetaUpdate(BaseModel):
    fields: dict

@app.put("/api/songs/{song_id}")
async def api_update_song(song_id: int, body: SongMetaUpdate):
    ok = db.update_song_meta(song_id, body.fields)
    return {"ok": ok}

class CueUpdate(BaseModel):
    cues: dict

@app.put("/api/songs/{song_id}/cue")
async def api_save_cue(song_id: int, body: CueUpdate):
    ok = db.save_cue_times(song_id, body.cues)
    return {"ok": ok, "cue_string": db.build_cue_times(body.cues)}

@app.post("/api/songs/import")
async def api_import_song(
    file: UploadFile = File(...),
    id_subcat: int = Form(...),
    id_genre: int = Form(0),
    song_type: int = Form(0),
    artist: str = Form(""),
    title: str = Form(""),
):
    """Import an audio file directly into the RadioDJ library."""
    import shutil
    # Determine target path from first path_map entry
    first_local = list(_lib["path_map"].values())[0]
    dest_dir = Path(first_local) / "TT_Import"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / file.filename

    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Read audio metadata
    duration = 0.0
    try:
        af = MutagenFile(str(dest))
        if af and af.info:
            duration = af.info.length
        if not artist and hasattr(af, "tags") and af.tags:
            tags = af.tags
            artist = str(tags.get("TPE1") or tags.get("artist") or [""])[0] or ""
            title  = str(tags.get("TIT2") or tags.get("title")  or [""])[0] or ""
    except Exception:
        pass

    title = title or Path(file.filename).stem

    db_path = db.local_path_to_db(str(dest))
    song_id = db.insert_song({
        "path": db_path,
        "song_type": song_type,
        "id_subcat": id_subcat,
        "id_genre": id_genre,
        "artist": artist,
        "title": title,
        "duration": round(duration, 5),
        "original_duration": round(duration, 5),
    })
    return {"ok": True, "song_id": song_id}

@app.get("/api/stats")
async def api_stats():
    return db.get_library_stats()

# ── Queue / On Air ───────────────────────────────────────────────────────────

@app.get("/api/queue")
async def api_queue():
    return db.get_queue()

@app.post("/api/queue/{song_id}")
async def api_queue_add(song_id: int):
    qid = db.add_to_queue(song_id)
    # Push to Liquidsoap if connected
    song = db.get_song(song_id)
    if song:
        liq.push(song["local_path"])
    return {"ok": True, "queue_id": qid}

@app.delete("/api/queue/{queue_id}")
async def api_queue_remove(queue_id: int):
    db.remove_from_queue(queue_id)
    return {"ok": True}

@app.delete("/api/queue")
async def api_queue_clear():
    db.clear_queue()
    return {"ok": True}

class ReorderBody(BaseModel):
    ids: list

@app.put("/api/queue/reorder")
async def api_queue_reorder(body: ReorderBody):
    db.reorder_queue(body.ids)
    return {"ok": True}

@app.post("/api/skip")
async def api_skip():
    result = liq.skip()
    return {"ok": True, "result": result}

@app.get("/api/liquidsoap/status")
async def api_liq_status():
    return {
        "connected": liq.is_connected(),
        "now_playing": liq.now_playing(),
        "status": liq.status(),
    }

# ── Carts / The Wall ─────────────────────────────────────────────────────────

@app.get("/api/carts")
async def api_carts():
    return db.get_cart_banks()

@app.get("/api/carts/{cart_id}")
async def api_cart(cart_id: int):
    bank = db.get_cart_bank(cart_id)
    if not bank:
        raise HTTPException(404)
    return bank

# ── Lookups ──────────────────────────────────────────────────────────────────

@app.get("/api/categories")
async def api_categories():
    return db.get_categories()

@app.get("/api/subcategories")
async def api_subcategories(parent: int = 0):
    return db.get_subcategories(parent)

@app.get("/api/genres")
async def api_genres():
    return db.get_genres()

# ── History ──────────────────────────────────────────────────────────────────

@app.get("/api/history")
async def api_history(q: str = "", limit: int = 100, offset: int = 0):
    return db.get_history(limit, offset, q)

# ── Voice tracking / The Booth ───────────────────────────────────────────────

@app.get("/api/voicetracks")
async def api_voicetracks():
    return db.get_voice_tracks()

@app.get("/api/voicetrack-context")
async def api_vt_context(prev_id: int = 0, next_id: int = 0):
    return db.get_voicetrack_context(prev_id, next_id)

@app.post("/api/voicetrack")
async def api_save_voicetrack(
    audio: UploadFile = File(...),
    artist: str = Form(""),
    title: str = Form(""),
    id_subcat: int = Form(0),
    prev_song_id: int = Form(0),
    next_song_id: int = Form(0),
):
    """Save a recorded voice track and insert into RadioDJ library."""
    vt_dir = Path(_lib["voice_track_dir"])
    # Sanitise filename
    safe_title = "".join(c for c in title if c.isalnum() or c in " -_")[:50]
    filename = f"vt_{safe_title}_{prev_song_id}_{next_song_id}.wav"
    dest = vt_dir / filename

    async with aiofiles.open(dest, "wb") as f:
        content = await audio.read()
        await f.write(content)

    # Get duration
    duration = 0.0
    try:
        af = MutagenFile(str(dest))
        if af and af.info:
            duration = af.info.length
    except Exception:
        pass

    db_path = db.local_path_to_db(str(dest))
    song_id = db.insert_song({
        "path": db_path,
        "song_type": 2,  # Voicetracker
        "id_subcat": id_subcat or 1,
        "id_genre": 0,
        "artist": artist or _cfg["station"]["artist_field"],
        "title": title,
        "duration": round(duration, 5),
        "original_duration": round(duration, 5),
    })
    return {"ok": True, "song_id": song_id, "filename": filename}

# ── Liquidsoap script generation ──────────────────────────────────────────────

class LiqScriptRequest(BaseModel):
    icecast_host: str
    icecast_port: int = 8000
    icecast_password: str
    mount_point: str = "/live"
    stream_name: str = "Squirrel FM"
    bitrate: int = 128

@app.post("/api/liquidsoap/generate")
async def api_gen_liq(body: LiqScriptRequest):
    script = generate_liquidsoap_script(
        body.icecast_host, body.icecast_port,
        body.icecast_password, body.mount_point,
        body.stream_name, body.bitrate
    )
    return {"script": script}

# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings/{source}/{key}")
async def api_get_setting(source: str, key: str):
    return {"value": db.get_setting(source, key)}

@app.put("/api/settings/{source}/{key}")
async def api_set_setting(source: str, key: str, value: str):
    db.set_setting(source, key, value)
    return {"ok": True}

# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app",
                host=_cfg["server"]["host"],
                port=_cfg["server"]["port"],
                reload=True)
