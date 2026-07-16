# ---- Stage 1: build React ----
FROM node:20-slim AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: Python runtime (one image; server + agent run different commands) ----
FROM python:3.11-slim AS app
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl \
        libgl1 libglib2.0-0 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

# uv binary
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Put the venv on PATH NOW, so every `python`/`uvicorn` below uses it.
ENV PATH="/app/.venv/bin:$PATH"

# Dep files first for layer caching (they live in server/)
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev

# App code: contents of server/ → /app
COPY server/ ./

# React bundle where server.py expects it
COPY --from=web-build /web/dist ./web/dist

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]