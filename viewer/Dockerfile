# viewer/Dockerfile
FROM python:3.11-slim
RUN pip install --no-cache-dir sqlite-web
EXPOSE 8080
# --read-only prevents accidental edits; remove it if you want to edit
CMD ["sqlite_web", "/data/taskmgr.sqlite3", "--host", "0.0.0.0", "--port", "8080", "--read-only"]
