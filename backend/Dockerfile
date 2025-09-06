# Works on Raspberry Pi (arm64/armv7) and x86_64
FROM python:3.11-slim-bullseye


ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1


RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*


WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt


# Copy source
COPY . /app


# Create persistent data dir for SQLite
RUN mkdir -p /data && chown -R 1000:1000 /data
ENV TASKMGR_DB_PATH=/data/taskmgr.sqlite3


EXPOSE 8000
CMD ["python", "app.py"]