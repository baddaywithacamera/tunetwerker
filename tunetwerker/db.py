"""
db.py — RadioDJ MariaDB interface for TUNE/TWERKER
Reads/writes the RadioDJ 2.0.4.7 schema directly.
"""
import json, re
from pathlib import Path
from typing import Optional
import pymysql
import pymysql.cursors

_cfg = json.loads(Path("config.json").read_text())
_db_cfg = _cfg["db"]
_lib_cfg = _cfg["library"]
_station_cfg = _cfg["station"]

# ── Connection ──────────────────────────────────────────────────────────────

def get_conn():
    return pymysql.connect(
        host=_db_cfg["host"],
        port=_db_cfg["port"],
        user=_db_cfg["user"],
        password=_db_cfg["password"],
        database=_db_cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )

# ── Path translation ────────────────────────────────────────────────────────

def db_path_to_local(db_path: str) -> str:
    """Translate a Windows DB path to the local filesystem path."""
    p = db_path.replace("\\", "/")
    for win_prefix, local_prefix in _lib_cfg["path_map"].items():
        win_norm = win_prefix.replace("\\", "/")
        if p.startswith(win_norm):
            return local_prefix + p[len(win_norm):]
    return p

def local_path_to_db(local_path: str) -> str:
    """Translate a local path back to a Windows DB path."""
    for win_prefix, local_prefix in _lib_cfg["path_map"].items():
        if local_path.startswith(local_prefix):
            rest = local_path[len(local_prefix):]
            return win_prefix + rest.replace("/", "\\")
    return local_path

# ── Cue times ───────────────────────────────────────────────────────────────

def parse_cue_times(cue_str: str) -> dict:
    """Parse '&sta=0.5&xta=200.0&end=201.0&fin=0&fou=1.5' → dict of floats."""
    result = {}
    if not cue_str or cue_str == "&":
        return result
    for part in cue_str.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            try:
                result[k] = float(v)
            except ValueError:
                result[k] = v
    return result

def build_cue_times(cues: dict) -> str:
    """Build cue_times string from dict. Omit zero/missing optional fields."""
    KEY_ORDER = ["sta", "int", "hin", "hou", "xta", "end", "fin", "fou"]
    REQUIRED = {"sta", "end"}
    parts = []
    for k in KEY_ORDER:
        if k in cues:
            v = cues[k]
            if k in REQUIRED or (v is not None and float(v) != 0):
                parts.append(f"{k}={v}")
    if not parts:
        return "&"
    return "&" + "&".join(parts)

# ── Songs ───────────────────────────────────────────────────────────────────

SONG_LIST_COLS = """
    s.ID, s.path, s.enabled, s.song_type, s.id_subcat, s.id_genre,
    s.artist, s.associated_artists, s.title, s.alternate_title,
    s.album, s.label, s.year, s.bpm, s.duration, s.original_duration,
    s.cue_times, s.loudness, s.bs1770, s.weight,
    s.count_played, s.date_played, s.date_added,
    s.mood, s.gender, s.lang, s.rating, s.image,
    s.start_date, s.end_date, s.overlay, s.comments,
    sc.name AS subcat_name, g.name AS genre_name
"""

def search_songs(query: str = "", subcat_id: int = 0, genre_id: int = 0,
                 song_type: int = -1, enabled_only: bool = False,
                 limit: int = 100, offset: int = 0) -> list:
    clauses = ["1=1"]
    params = []
    if query:
        clauses.append("(s.artist LIKE %s OR s.title LIKE %s OR s.album LIKE %s OR s.associated_artists LIKE %s)")
        q = f"%{query}%"
        params += [q, q, q, q]
    if subcat_id:
        clauses.append("s.id_subcat = %s"); params.append(subcat_id)
    if genre_id:
        clauses.append("s.id_genre = %s"); params.append(genre_id)
    if song_type >= 0:
        clauses.append("s.song_type = %s"); params.append(song_type)
    if enabled_only:
        clauses.append("s.enabled = 1")
    where = " AND ".join(clauses)
    sql = f"""
        SELECT {SONG_LIST_COLS}
        FROM songs s
        LEFT JOIN subcategory sc ON sc.ID = s.id_subcat
        LEFT JOIN genre g ON g.id = s.id_genre
        WHERE {where}
        ORDER BY s.artist, s.title
        LIMIT %s OFFSET %s
    """
    params += [limit, offset]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    for r in rows:
        r["cues"] = parse_cue_times(r.get("cue_times") or "&")
        r["local_path"] = db_path_to_local(r["path"])
    return rows

def get_song(song_id: int) -> Optional[dict]:
    sql = f"""
        SELECT {SONG_LIST_COLS},
               s.composer, s.original_artist, s.publisher, s.copyright,
               s.isrc, s.track_no, s.disc_no, s.buy_link, s.url1, s.url2,
               s.tdate_played, s.tartist_played, s.ttitle_played, s.talbum_played,
               s.play_limit, s.limit_action, s.precise_cue, s.fade_type,
               s.start_type, s.end_type, s.mix_type, s.sweepers,
               s.originalmetadata, s.overlay, s.startEvent, s.endEvent
        FROM songs s
        LEFT JOIN subcategory sc ON sc.ID = s.id_subcat
        LEFT JOIN genre g ON g.id = s.id_genre
        WHERE s.ID = %s
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, [song_id])
            row = cur.fetchone()
    if row:
        row["cues"] = parse_cue_times(row.get("cue_times") or "&")
        row["local_path"] = db_path_to_local(row["path"])
    return row

def save_cue_times(song_id: int, cues: dict) -> bool:
    cue_str = build_cue_times(cues)
    # Recalculate duration from cue points if sta and end are present
    updates = {"cue_times": cue_str}
    if "sta" in cues and "end" in cues:
        updates["duration"] = round(float(cues["end"]) - float(cues["sta"]), 5)
    with get_conn() as conn:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"`{k}` = %s" for k in updates)
            cur.execute(
                f"UPDATE songs SET {set_clause} WHERE ID = %s",
                list(updates.values()) + [song_id]
            )
    return True

def update_song_meta(song_id: int, fields: dict) -> bool:
    ALLOWED = {
        "artist", "associated_artists", "title", "alternate_title", "album",
        "composer", "original_artist", "label", "publisher", "copyright",
        "isrc", "year", "track_no", "disc_no", "bpm", "comments",
        "mood", "gender", "lang", "rating", "weight", "enabled",
        "id_subcat", "id_genre", "song_type", "buy_link", "url1", "url2",
        "start_date", "end_date", "play_limit", "limit_action", "overlay",
        "loudness", "bs1770", "fade_type", "start_type", "end_type", "mix_type"
    }
    safe = {k: v for k, v in fields.items() if k in ALLOWED}
    if not safe:
        return False
    with get_conn() as conn:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"`{k}` = %s" for k in safe)
            cur.execute(
                f"UPDATE songs SET {set_clause}, date_modified = NOW() WHERE ID = %s",
                list(safe.values()) + [song_id]
            )
    return True

def insert_song(fields: dict) -> int:
    REQUIRED = {"path", "song_type", "id_subcat", "id_genre",
                "artist", "title", "duration", "original_duration"}
    for r in REQUIRED:
        if r not in fields:
            raise ValueError(f"Missing required field: {r}")
    fields.setdefault("enabled", 1)
    fields.setdefault("weight", 50.0)
    fields.setdefault("cue_times", "&")
    fields.setdefault("loudness", 1.0)
    fields.setdefault("bs1770", 0.0)
    fields.setdefault("image", "no_image.jpg")
    fields.setdefault("buy_link", "http://")
    fields.setdefault("url1", "http://")
    fields.setdefault("url2", "http://")
    fields.setdefault("cue_times", "&")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cols = ", ".join(f"`{k}`" for k in fields)
            placeholders = ", ".join(["%s"] * len(fields))
            cur.execute(
                f"INSERT INTO songs ({cols}, date_added, date_modified) "
                f"VALUES ({placeholders}, NOW(), NOW())",
                list(fields.values())
            )
            return cur.lastrowid

# ── Queue ───────────────────────────────────────────────────────────────────

def get_queue() -> list:
    sql = """
        SELECT q.ID, q.songID, q.ETA, q.duration, q.artist,
               q.associated_artists, q.title, q.album,
               q.swID, q.swPlay, q.vtID, q.vtPlay,
               s.path, s.cue_times, s.loudness, s.bs1770,
               s.song_type, s.id_subcat, s.image,
               sc.name AS subcat_name
        FROM queuelist q
        LEFT JOIN songs s ON s.ID = q.songID
        LEFT JOIN subcategory sc ON sc.ID = s.id_subcat
        ORDER BY q.ID ASC
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    for r in rows:
        r["cues"] = parse_cue_times(r.get("cue_times") or "&")
        if r.get("path"):
            r["local_path"] = db_path_to_local(r["path"])
    return rows

def add_to_queue(song_id: int) -> int:
    song = get_song(song_id)
    if not song:
        raise ValueError(f"Song {song_id} not found")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO queuelist
                    (songID, duration, artist, associated_artists, title, album, swID, swPlay, vtID, vtPlay)
                VALUES (%s, %s, %s, %s, %s, %s, -1, 0, -1, 0)
            """, [
                song_id, song["duration"], song["artist"],
                song.get("associated_artists", ""),
                song["title"], song.get("album", "")
            ])
            return cur.lastrowid

def remove_from_queue(queue_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM queuelist WHERE ID = %s", [queue_id])

def clear_queue():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM queuelist")

def reorder_queue(ordered_ids: list):
    """Reorder queue by rebuilding IDs in order."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for pos, qid in enumerate(ordered_ids):
                cur.execute("UPDATE queuelist SET ID = %s WHERE ID = %s",
                            [-(pos + 1), qid])
            for pos in range(len(ordered_ids)):
                cur.execute("UPDATE queuelist SET ID = %s WHERE ID = %s",
                            [pos + 1, -(pos + 1)])

# ── Carts ───────────────────────────────────────────────────────────────────

def get_cart_banks() -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT ID, name FROM carts ORDER BY ID")
            return cur.fetchall()

def get_cart_bank(cart_id: int) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT ID, name FROM carts WHERE ID = %s", [cart_id])
            bank = cur.fetchone()
            if not bank:
                return {}
            cur.execute("""
                SELECT cl.ID, cl.swID, cl.swButton, cl.color,
                       s.path, s.artist, s.title, s.duration,
                       s.cue_times, s.loudness, s.bs1770
                FROM carts_list cl
                LEFT JOIN songs s ON s.ID = cl.swID
                WHERE cl.pID = %s
                ORDER BY cl.swButton ASC
            """, [cart_id])
            buttons = cur.fetchall()
    for b in buttons:
        b["cues"] = parse_cue_times(b.get("cue_times") or "&")
        if b.get("path"):
            b["local_path"] = db_path_to_local(b["path"])
    bank["buttons"] = buttons
    return bank

# ── Lookup tables ────────────────────────────────────────────────────────────

def get_categories() -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.ID, c.name,
                       COUNT(sc.ID) AS subcat_count
                FROM category c
                LEFT JOIN subcategory sc ON sc.parentid = c.ID
                GROUP BY c.ID ORDER BY c.name
            """)
            return cur.fetchall()

def get_subcategories(parent_id: int = 0) -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if parent_id:
                cur.execute("""
                    SELECT sc.ID, sc.parentid, sc.name, c.name AS category_name,
                           COUNT(s.ID) AS track_count
                    FROM subcategory sc
                    LEFT JOIN category c ON c.ID = sc.parentid
                    LEFT JOIN songs s ON s.id_subcat = sc.ID
                    WHERE sc.parentid = %s
                    GROUP BY sc.ID ORDER BY sc.name
                """, [parent_id])
            else:
                cur.execute("""
                    SELECT sc.ID, sc.parentid, sc.name, c.name AS category_name,
                           COUNT(s.ID) AS track_count
                    FROM subcategory sc
                    LEFT JOIN category c ON c.ID = sc.parentid
                    LEFT JOIN songs s ON s.id_subcat = sc.ID
                    GROUP BY sc.ID ORDER BY c.name, sc.name
                """)
            return cur.fetchall()

def get_genres() -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM genre ORDER BY name")
            return cur.fetchall()

# ── History ──────────────────────────────────────────────────────────────────

def get_history(limit: int = 100, offset: int = 0, query: str = "") -> list:
    clauses = ["1=1"]
    params = []
    if query:
        clauses.append("(artist LIKE %s OR title LIKE %s)")
        q = f"%{query}%"
        params += [q, q]
    where = " AND ".join(clauses)
    sql = f"""
        SELECT ID, trackID, date_played, song_type, id_subcat, id_genre,
               duration, artist, title, album, listeners
        FROM history
        WHERE {where}
        ORDER BY date_played DESC
        LIMIT %s OFFSET %s
    """
    params += [limit, offset]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

# ── Voice tracks ─────────────────────────────────────────────────────────────

def get_voice_tracks(limit: int = 50) -> list:
    """Voice tracks are stored as songs with song_type = 2."""
    return search_songs(song_type=2, limit=limit)

def get_voicetrack_context(prev_song_id: int, next_song_id: int) -> dict:
    """Return prev + next song details for voice track recording context."""
    return {
        "prev": get_song(prev_song_id) if prev_song_id else None,
        "next": get_song(next_song_id) if next_song_id else None,
    }

# ── Settings ──────────────────────────────────────────────────────────────────

def get_setting(source: str, key: str, default=None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM settings WHERE source=%s AND setting=%s",
                [source, key]
            )
            row = cur.fetchone()
    return row["value"] if row else default

def set_setting(source: str, key: str, value: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO settings (source, setting, value) VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE value = VALUES(value)
            """, [source, key, value])

# ── Stats ────────────────────────────────────────────────────────────────────

def get_library_stats() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS total, SUM(duration)/3600 AS hours FROM songs WHERE enabled=1")
            totals = cur.fetchone()
            cur.execute("""
                SELECT song_type, COUNT(*) AS cnt
                FROM songs WHERE enabled=1
                GROUP BY song_type
            """)
            by_type = cur.fetchall()
            cur.execute("SELECT COUNT(*) AS cnt FROM history")
            hist = cur.fetchone()
    return {
        "total_tracks": totals["total"],
        "total_hours": round(totals["hours"] or 0, 1),
        "by_type": by_type,
        "history_entries": hist["cnt"],
    }
