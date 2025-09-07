from datetime import datetime, timedelta
import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from sqlalchemy import select, func, text
from db import Base, engine, SessionLocal
from models import Task, TaskLog

app = Flask(__name__, static_folder="static", static_url_path="/")
CORS(app)

# Ensure DB tables exist
Base.metadata.create_all(bind=engine)

# --- lightweight migrations ---
def ensure_schema():
    with engine.begin() as conn:
        # 1) Add TaskLog.title if missing (you already had this)
        cols_logs = [row[1] for row in conn.execute(text("PRAGMA table_info(task_logs)"))]
        if "title" not in cols_logs:
            conn.execute(text("ALTER TABLE task_logs ADD COLUMN title VARCHAR"))

        # 2) Add tasks.due_at (TEXT) for one-off tasks if missing
        cols_tasks = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "due_at" not in cols_tasks:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN due_at TEXT"))
ensure_schema()

# ---------- Helpers ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

FREQ_TO_SECONDS = {"hours": 3600, "days": 86400, "weeks": 604800}

def parse_iso_utc(s: str) -> datetime:
    """Parse ISO8601; if it ends with 'Z' treat as UTC; otherwise assume UTC naive."""
    s = (s or "").strip()
    if not s:
        raise ValueError("empty datetime")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except Exception as e:
        raise ValueError(f"invalid datetime: {s}") from e

def iso_utc(d: datetime) -> str:
    """Return ISO8601 string with trailing 'Z' (UTC)."""
    # treat incoming naive datetimes as UTC
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

def set_oneoff_due(task_id: int, due_iso: str | None):
    """Persist tasks.due_at via raw SQL (models.py unchanged)."""
    with engine.begin() as conn:
        if due_iso is None:
            conn.execute(text("UPDATE tasks SET due_at = NULL WHERE id = :id"), {"id": task_id})
        else:
            # normalize to Z string
            dt_val = parse_iso_utc(due_iso)
            conn.execute(
                text("UPDATE tasks SET due_at = :due WHERE id = :id"),
                {"due": iso_utc(dt_val), "id": task_id},
            )

# ---------- API ----------
@app.get("/api/tasks")
def list_tasks():
    db = next(get_db())
    tasks = db.execute(select(Task)).scalars().all()

    # last-done lookup (for repeating schedules)
    last_map = {
        tid: ts for tid, ts in db.query(TaskLog.task_id, func.max(TaskLog.done_at))
        .group_by(TaskLog.task_id).all()
    }

    # read one-off due_at values (stored in tasks.due_at TEXT)
    oneoff_due = get_oneoff_due_map(db)

    payload = []
    now = datetime.utcnow()
    for t in tasks:
        last_done = last_map.get(t.id)

        if t.freq_unit == "once":
            # Exact due comes from tasks.due_at (if missing, fall back to created_at)
            due_at_dt = oneoff_due.get(t.id) or (last_done or t.created_at)
            is_due = now >= due_at_dt
            payload.append({
                "id": t.id,
                "title": t.title,
                "notes": t.notes,
                "freq_value": t.freq_value,
                "freq_unit": t.freq_unit,
                "is_active": t.is_active,
                "last_done": last_done.isoformat() + "Z" if last_done else None,
                "due_at": iso_utc(due_at_dt),
                "is_due": is_due,
            })
        else:
            # Repeating: compute from last_done (or created_at) + interval
            seconds = FREQ_TO_SECONDS.get(t.freq_unit, 86400) * max(int(t.freq_value or 1), 1)
            due_at_dt = (last_done or t.created_at) + timedelta(seconds=seconds)
            is_due = now >= due_at_dt
            payload.append({
                "id": t.id,
                "title": t.title,
                "notes": t.notes,
                "freq_value": t.freq_value,
                "freq_unit": t.freq_unit,
                "is_active": t.is_active,
                "last_done": last_done.isoformat() + "Z" if last_done else None,
                "due_at": iso_utc(due_at_dt),
                "is_due": is_due,
            })
    return jsonify(payload)

@app.post("/api/tasks")
def create_task():
    db = next(get_db())
    data = request.get_json(force=True)

    freq_unit = data.get("freq_unit", "days")
    freq_value = int(data.get("freq_value", 1))
    t = Task(
        title=data.get("title", "Untitled"),
        notes=data.get("notes"),
        freq_value=0 if freq_unit == "once" else freq_value,
        freq_unit=freq_unit,
        is_active=True,
    )
    db.add(t)
    db.commit()

    # For one-off, require due_at and store in tasks.due_at (TEXT, ISO Z)
    if freq_unit == "once":
        due_at = data.get("due_at")
        if not due_at:
            return jsonify({"error": "due_at required for one-off task"}), 400
        try:
            set_oneoff_due(t.id, due_at)
        except ValueError:
            return jsonify({"error": "invalid due_at"}), 400

    return jsonify({"id": t.id}), 201

@app.put("/api/tasks/<int:task_id>")
def update_task(task_id: int):
    db = next(get_db())
    t = db.get(Task, task_id)
    if not t:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json(force=True)
    old_unit = t.freq_unit

    for k in ["title", "notes", "freq_value", "freq_unit", "is_active"]:
        if k in data:
            setattr(t, k, data[k])

    # Normalize values
    t.freq_unit = t.freq_unit or "days"
    if t.freq_unit != "once":
        try:
            t.freq_value = max(int(t.freq_value or 1), 1)
        except Exception:
            t.freq_value = 1
    else:
        # one-off stores no repeating interval
        t.freq_value = 0

    t.updated_at = datetime.utcnow()
    db.commit()

    # handle due_at persistence when one-off
    if t.freq_unit == "once":
        due_at = data.get("due_at")
        if due_at:
            try:
                set_oneoff_due(task_id, due_at)
            except ValueError:
                return jsonify({"error": "invalid due_at"}), 400
        else:
            # if switching to once and we have no stored due_at yet, require it
            oneoff_due = get_oneoff_due_map(db).get(task_id)
            if oneoff_due is None and old_unit != "once":
                return jsonify({"error": "due_at required when switching to one-off"}), 400
    else:
        # switching away from once: clear due_at
        if old_unit == "once":
            set_oneoff_due(task_id, None)

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
