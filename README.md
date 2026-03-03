# ⚡ CyberpunkTerm

A cyberpunk-themed Kubernetes web terminal — exec into any pod and watch live metrics, right from your browser.

![stack](https://img.shields.io/badge/stack-React%20%2B%20FastAPI%20%2B%20k8s-blueviolet)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Overview

| Layer | Tech |
|---|---|
| **Frontend** | React 19 + xterm.js + Vite · served by nginx |
| **Backend** | Python 3.12 · FastAPI · `kubernetes` client |
| **User shell** | Alpine 3.21 toolbox container |
| **Infra** | Kubernetes · Helm v3 |

### Architecture

```
Browser
  │
  └── nginx pod (cyberpunkterm-frontend)
        │  ws://cyberpunkterm-backend:8000/ws/terminal
        │  ws://cyberpunkterm-backend:8000/ws/metrics
        ↓
  FastAPI pod (cyberpunkterm-backend)
        │  kubectl exec / CoreV1Api + metrics-server
        ↓
  toolbox-0 pod
```

Everything runs **inside the cluster** — no `kubectl port-forward` or local `npm run dev` needed.

---

## Project Structure

```
cyberpunkterm/
├── frontend/                        # Vite + React app
│   ├── src/App.jsx                  # xterm.js terminal + metrics UI
│   ├── Dockerfile                   # multi-stage: node build → nginx serve
│   └── nginx.conf                   # SPA-friendly nginx config
│
└── backend/
    ├── toolbox/                     # Lightweight user shell image (Alpine)
    │   └── Dockerfile
    ├── cyberterminalbackend/        # FastAPI WebSocket bridge
    │   ├── main.py
    │   ├── requirements.txt
    │   └── Dockerfile
    └── helm/cyberpunkterm/          # Helm chart (v0.1.0)
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
            ├── deployment.yaml          # Backend Deployment
            ├── service.yaml             # Backend ClusterIP :8000
            ├── frontend-deployment.yaml # Frontend nginx Deployment
            ├── frontend-service.yaml    # Frontend Service :80
            ├── serviceaccount.yaml
            ├── clusterrole.yaml         # pods/exec + metrics RBAC
            ├── clusterrolebinding.yaml
            ├── toolbox-statefulset.yaml
            └── toolbox-service.yaml     # Headless service
```

---

## Prerequisites

- Docker
- Kubernetes cluster (e.g. [minikube](https://minikube.sigs.k8s.io/))
- Helm v3
- [metrics-server](https://github.com/kubernetes-sigs/metrics-server) installed in the cluster (for CPU/mem metrics)

---

## Quick Start (minikube)

### 1. Point Docker at minikube's daemon

```bash
eval $(minikube docker-env)
```

This makes images built locally instantly available to the cluster — no registry push needed.

### 2. Build all images

```bash
# Frontend (React → nginx)
docker build \
  --build-arg VITE_WS_BASE=ws://cyberpunkterm-backend:8000 \
  -t cyberpunkterm/frontend:0.1.0 \
  frontend/

# Backend WebSocket bridge
docker build \
  -t cyberpunkterm/backend:0.1.0 \
  backend/cyberterminalbackend/

# Toolbox user shell
docker build \
  -t cyberpunkterm/toolbox:0.1.0 \
  backend/toolbox/
```

### 3. Deploy with Helm

```bash
helm upgrade --install cyberpunkterm backend/helm/cyberpunkterm \
  --namespace cyberterm \
  --create-namespace
```

### 4. Access the UI

```bash
# Expose the frontend service
kubectl port-forward svc/cyberpunkterm-frontend 8080:80 -n cyberterm
```

Open **http://localhost:8080** in your browser.

- **namespace**: `cyberterm`
- **pod**: `toolbox-0`
- Hit **CONNECT** — TERM and METRICS dots should turn green ✅

> Alternatively, change `frontend.service.type` to `NodePort` in `values.yaml`
> and use `minikube service cyberpunkterm-frontend -n cyberterm` to open it directly.

---

## Configuration

Key `values.yaml` options (override with `--set` or `-f my-values.yaml`):

| Key | Default | Description |
|---|---|---|
| `backend.image.tag` | `0.1.0` | Backend image tag |
| `frontend.image.tag` | `0.1.0` | Frontend image tag |
| `frontend.service.type` | `ClusterIP` | Set to `NodePort`/`LoadBalancer` to expose externally |
| `frontend.wsBase` | `ws://cyberpunkterm-backend:8000` | Backend WS URL baked into the JS bundle |
| `toolbox.image.tag` | `0.1.0` | Toolbox image tag |
| `toolbox.replicaCount` | `1` | Number of toolbox pods |
| `backend.env.METRICS_INTERVAL_SECONDS` | `5` | Metrics push interval |
| `toolbox.persistence.enabled` | `false` | Persist `/home/toolbox` via PVC |
| `toolbox.persistence.size` | `1Gi` | PVC size per pod |
| `rbac.create` | `true` | Create ClusterRole + binding |

---

## Helm Versioning

| Chart version | App version | Notes |
|---|---|---|
| `0.1.0` | `0.1.0` | Initial release — frontend in cluster |

Bump `version` in `Chart.yaml` for chart-only changes; bump `appVersion` when container images change.

---

## Local Dev (no cluster)

Run just the frontend locally against a port-forwarded backend:

```bash
# Terminal 1 — forward the backend
kubectl port-forward svc/cyberpunkterm-backend 8000:8000 -n cyberterm

# Terminal 2 — start the dev server (WS_BASE falls back to ws://localhost:8000)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Or run the backend directly without a cluster:

```bash
cd backend/cyberterminalbackend
pip install -r requirements.txt
KUBECONFIG=~/.kube/config uvicorn main:app --reload --port 8000
```

---

## Security Notes

> **⚠️ This is a developer tool — harden before exposing externally.**

- The backend uses a `ClusterRole` with `pods/exec` — restrict to specific namespaces for production.
- Add authentication (e.g. OAuth2 / OIDC) in front of the WebSocket endpoints.
- Enable Kubernetes audit logging to track exec sessions.

---

## License

MIT
