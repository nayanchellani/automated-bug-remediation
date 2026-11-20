# Stage 1: install the Node static analyzer dependencies (Babel 8 needs Node >= 22.18)
FROM node:22-slim AS analyzer-deps
WORKDIR /analyzer
COPY analyzer/package.json analyzer/package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Python API
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Node runtime used only to run analyzer/analyze.mjs (parses code, never executes it)
COPY --from=analyzer-deps /usr/local/bin/node /usr/local/bin/node

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=analyzer-deps /analyzer/node_modules ./analyzer/node_modules

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]
