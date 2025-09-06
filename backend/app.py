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

# --- lightweight migration: add TaskLog.title if missing (SQLite) ---
def ensure_schema():
    with engine.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(task_logs)"))]
        if "title" not in cols:
            conn.execute(text("ALTER TABLE task_logs ADD COLUMN title VARCHAR"))
ensure_schema()

# ---------- Helpers ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

FREQ_TO_SECONDS = {"hours": 3600, "days": 86400, "weeks": 604800}

# ---------- API ----------
@app.get("/api/tasks")
def list_tasks():
    db = next(get_db())
    tasks = db.execute(select(Task)).scalars().all()
    # last-done lookup
    last_map = {
        tid: ts for tid, ts in db.query(TaskLog.task_id, func.max(TaskLog.done_at))
        .group_by(TaskLog.task_id).all()
    }
    payload = []
    now = datetime.utcnow()
    for t in tasks:
        last_done = last_map.get(t.id)
        seconds = FREQ_TO_SECONDS.get(t.freq_unit, 86400) * t.freq_value
        due_at = (last_done or t.created_at) + timedelta(seconds=seconds)
        is_due = now >= due_at
        payload.append({
            "id": t.id,
            "title": t.title,
            "notes": t.notes,
            "freq_value": t.freq_value,
            "freq_unit": t.freq_unit,
            "is_active": t.is_active,
            "last_done": last_done.isoformat() if last_done else None,
            "due_at": due_at.isoformat(),
            "is_due": is_due,
        })
    return jsonify(payload)

@app.post("/api/tasks")
def create_task():
    db = next(get_db())
    data = request.get_json(force=True)
    t = Task(
        title=data.get("title", "Untitled"),
        notes=data.get("notes"),
        freq_value=int(data.get("freq_value", 1)),
        freq_unit=data.get("freq_unit", "days"),
        is_active=True,
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
    for k in ["title", "notes", "freq_value", "freq_unit", "is_active"]:
        if k in data:
            setattr(t, k, data[k])
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
    log = TaskLog(task_id=task_id, title=t.title)
    db.add(log)
    db.commit()
    return jsonify({"ok": True, "done_at": log.done_at.isoformat(), "title": log.title})

@app.get("/api/logs")
def list_logs():
    db = next(get_db())
    logs = db.query(TaskLog).order_by(TaskLog.done_at.desc()).limit(100).all()
    return jsonify([
        {
            "id": l.id,
            "task_id": l.task_id,
            "title": l.title,
            "done_at": l.done_at.isoformat(),
        } for l in logs
    ])

@app.get("/")
def root():
    return send_from_directory("static", "index.html")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
