from datetime import datetime, timedelta, timezone
import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func, text
from db import Base, engine, SessionLocal
from models import Task, TaskLog
import re

app = Flask(__name__, static_folder="static", static_url_path="/")
CORS(app)

# Ensure DB tables exist
Base.metadata.create_all(bind=engine)

# --- lightweight migrations ---
def ensure_schema():
    with engine.begin() as conn:
        # task_logs.title
        cols_logs = [row[1] for row in conn.execute(text("PRAGMA table_info(task_logs)"))]
        if "title" not in cols_logs:
            conn.execute(text("ALTER TABLE task_logs ADD COLUMN title VARCHAR"))

        # tasks.due_at
        cols_tasks = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "due_at" not in cols_tasks:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN due_at TIMESTAMP NULL"))
def normalize_due_at_values():
    """Fix any malformed text values in tasks.due_at (e.g., '+00:00Z')."""
    with SessionLocal() as db:
        rows = db.execute(text("SELECT id, due_at FROM tasks WHERE due_at IS NOT NULL")).fetchall()
        fixed = 0
        for id_, raw in rows:
            # Some SQLite drivers hand back strings for TIMESTAMP columns
            if isinstance(raw, str):
                try:
                    dt = parse_lenient_iso_to_naive_utc(raw)
                except Exception:
                    continue
                if dt is not None:
                    db.execute(text("UPDATE tasks SET due_at = :dt WHERE id = :id"), {"dt": dt, "id": id_})
                    fixed += 1
        if fixed:
            db.commit()

ensure_schema()
normalize_due_at_values()


# ---------- Helpers ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

FREQ_TO_SECONDS = {"hours": 3600, "days": 86400, "weeks": 604800}

# app.py (helpers)
def parse_iso_utc(s: str | None):
    if not s:
        return None
    try:
        # Accept 'Z' and offsets; store naive UTC (SQLite)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def parse_lenient_iso_to_naive_utc(s: str | None):
    """
    Accepts '2025-09-07T18:30:00Z', '...+00:00', or even the bad '...+00:00Z'.
    Returns a naive UTC datetime (tzinfo=None) for SQLite.
    """
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z") and re.search(r"[+-]\d{2}:?\d{2}$", s[:-1]):
        s = s[:-1]                     # drop the stray Z if an offset is present
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"          # make 'Z' parseable

    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        # last resort: strip a trailing offset/Z and parse as naive
        s2 = re.sub(r"([+-]\d{2}:?\d{2}|Z)$", "", s)
        dt = datetime.fromisoformat(s2)

    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

def iso_utc(d: datetime | None):
    """Safe ISO string for JSON. Returns None if d is None."""
    if d is None:
        return None
    if d.tzinfo:
        d = d.astimezone(timezone.utc).replace(tzinfo=None)
    return d.replace(microsecond=0).isoformat() + "Z"
def get_oneoff_due_map(db):
    """Return {task_id: due_at_datetime or None} for tasks where freq_unit='once'."""
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, due_at FROM tasks WHERE freq_unit = :u"), {"u": "once"}).fetchall()
    due_map = {}
    for tid, due_txt in rows:
        if due_txt:
            try:
                due_map[tid] = parse_iso_utc(due_txt)
            except Exception:
                due_map[tid] = None
        else:
            due_map[tid] = None
    return due_map

def set_oneoff_due(task_id: int, dt_val):
    """
    Stores due_at for a one-off task. Accepts str or datetime.
    Ignores if dt_val is None/invalid. Writes a naive UTC datetime.
    """
    if dt_val is None:
        return False

    if isinstance(dt_val, str):
        dt = parse_lenient_iso_to_naive_utc(dt_val)
    else:
        dt = dt_val
        if dt and dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)

    if not dt:
        return False

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE tasks SET due_at = :dt WHERE id = :id"),
            {"dt": dt, "id": task_id},
        )
    return True

# ---------- API ----------
@app.get("/api/tasks")
def list_tasks():
    db = next(get_db())
    tasks = db.execute(select(Task)).scalars().all()

    # last done per task
    last_map = {
        tid: ts
        for tid, ts in db.query(TaskLog.task_id, func.max(TaskLog.done_at))
        .group_by(TaskLog.task_id).all()
    }

    payload = []
    now = datetime.utcnow()

    for t in tasks:
        if t.freq_unit == "once":
            # one-off tasks use their explicit due_at; fall back to created_at if missing
            due_at = t.due_at or t.created_at
        else:
            # recurring tasks: last_done + freq
            base = last_map.get(t.id) or t.created_at
            seconds = FREQ_TO_SECONDS.get(t.freq_unit, 86400) * t.freq_value
            due_at = base + timedelta(seconds=seconds)

        is_due = now >= due_at

        payload.append({
            "id": t.id,
            "title": t.title,
            "notes": t.notes,
            "freq_value": t.freq_value,
            "freq_unit": t.freq_unit,
            "is_active": t.is_active,
            "last_done": (last_map.get(t.id).isoformat() if last_map.get(t.id) else None),
            "due_at": due_at.isoformat(),
            "is_due": is_due,
        })

    return jsonify(payload)


@app.post("/api/tasks")
def create_task():
    db = next(get_db())
    data = request.get_json(force=True)

    unit = data.get("freq_unit", "days")
    due_dt = None
    if unit == "once":
        due_dt = parse_lenient_iso_to_naive_utc(data.get("due_at"))
        if due_dt is None:
            return jsonify({"error": "Missing or invalid due_at for one-off task"}), 400

    t = Task(
        title=data.get("title", "Untitled"),
        notes=data.get("notes"),
        freq_value=int(data.get("freq_value", 0 if unit == "once" else 1)),
        freq_unit=unit,
        is_active=True,
        due_at=due_dt,
    )
    db.add(t)
    db.commit()
    return jsonify({"id": t.id}), 201


@app.put("/api/tasks/<int:task_id>")
def update_task(task_id: int):
    db = next(get_db())
    t = db.get(Task, task_id)
    if not t:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json(force=True)

    # basic fields
    for k in ["title", "notes", "freq_value", "freq_unit", "is_active"]:
        if k in data:
            setattr(t, k, data[k])

    # one-off handling
    if t.freq_unit == "once":
        if "due_at" in data:
            t.due_at = parse_iso_utc(data.get("due_at"))
        # freq_value isn't used for once; keep it 0
        t.freq_value = 0
    else:
        # recurring task: clear any stale due_at
        t.due_at = None
        if not t.freq_value:
            t.freq_value = 1

    t.updated_at = datetime.utcnow()
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/tasks/<int:task_id>")
def delete_task(task_id: int):
    db = next(get_db())
    t = db.get(Task, task_id)
    if not t:
        return jsonify({"error": "Not found"}), 404
    db.delete(t)
    db.commit()
    return jsonify({"ok": True})

@app.post("/api/tasks/<int:task_id>/complete")
def complete_task(task_id: int):
    db = next(get_db())
    t = db.get(Task, task_id)
    if not t:
        return jsonify({"error": "Not found"}), 404

    # log completion (title snapshot preserved)
    log = TaskLog(task_id=task_id, title=t.title)
    db.add(log)

    # If one-off: deactivate on completion (no reschedule)
    if t.freq_unit == "once":
        t.is_active = False
        db.commit()
        return jsonify({"ok": True, "done_at": log.done_at.isoformat() + "Z", "title": log.title})

    # Repeating: nothing else to change here; list endpoint computes next due
    db.commit()
    return jsonify({"ok": True, "done_at": log.done_at.isoformat() + "Z", "title": log.title})

@app.get("/api/logs")
def list_logs():
    db = next(get_db())
    logs = db.query(TaskLog).order_by(TaskLog.done_at.desc()).limit(100).all()
    return jsonify([
        {
            "id": l.id,
            "task_id": l.task_id,
            "title": l.title,
            "done_at": l.done_at.isoformat() + "Z",
        } for l in logs
    ])

@app.get("/")
def root():
    return send_from_directory("static", "index.html")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
