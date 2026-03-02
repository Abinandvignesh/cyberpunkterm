# ─────────────────────────────────────────────────────────────────────────────
# cyberterminalbackend — WebSocket bridge for CyberpunkTerm
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim

LABEL org.opencontainers.image.title="cyberpunkterm-backend" \
    org.opencontainers.image.description="FastAPI WebSocket bridge — kubectl exec + pod metrics" \
    org.opencontainers.image.version="0.1.0"

# System deps needed by the kubernetes client (cert verification, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache friendly)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Non-root user
RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 8000

ENV PORT=8000 \
    METRICS_INTERVAL_SECONDS=5

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
