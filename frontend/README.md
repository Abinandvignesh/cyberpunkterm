# CyberpunkTerm — Frontend

React 19 + xterm.js + Vite — cyberpunk web terminal UI for the CyberpunkTerm Kubernetes exec console.

---

## Running in Docker (recommended — deployed via Helm)

The frontend is built as a static nginx image and deployed inside the cluster alongside the backend. See the root [README](../README.md) for the full deployment guide.

### Build the image (minikube)

```bash
# Point your Docker CLI at minikube's internal daemon
eval $(minikube docker-env)

# Build — bakes the backend WebSocket URL into the JS bundle
docker build \
  --build-arg VITE_WS_BASE=ws://cyberpunkterm-backend:8000 \
  -t cyberpunkterm/frontend:0.1.0 .
```

---

## Local Dev (no Docker)

```bash
npm install
npm run dev
# → http://localhost:5173
# Requires kubectl port-forward svc/cyberpunkterm-backend 8000:8000
```

The `VITE_WS_BASE` env var defaults to `ws://localhost:8000` when not set, so local dev works out of the box.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_BASE` | `ws://localhost:8000` | WebSocket base URL for the backend |
