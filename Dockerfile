# FlashMapping — production image.
# FastAPI serves both the API (/api/*) and the Vue 3 SPA (/*).
# Runtime env vars expected: MONGO_URI, MONGO_DB, JWT_SECRET, PIPEDRIVE_API_KEY.
# Listens on $PORT (default 3000 to match the Traefik label in the EDJ Labs stack).

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=3000

WORKDIR /app

# System deps — bcrypt needs a C toolchain for the wheel fallback on some archs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

# Python deps first (better layer caching).
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# App source.
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
# XLSX builder sits at project root — imported by the /export/xlsx routes via
# a sys.path insert of PROJECT_ROOT.
COPY build_xlsx.py /app/build_xlsx.py

WORKDIR /app/backend

EXPOSE 3000

# Shell form so $PORT is interpolated at runtime.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3000} --proxy-headers --forwarded-allow-ips="*"
