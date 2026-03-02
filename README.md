# ⚡ CyberpunkTerm

A cyberpunk-themed Kubernetes web terminal — exec into any pod and watch live metrics, right from your browser.

![stack](https://img.shields.io/badge/stack-React%20%2B%20FastAPI%20%2B%20k8s-blueviolet)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Overview

| Layer | Tech |
|---|---|
| **Frontend** | React 19 + xterm.js + Vite |
| **Backend** | Python 3.12 · FastAPI · `kubernetes` client |
| **User shell** | Alpine 3.21 toolbox container |
| **Infra** | Kubernetes · Helm v3 |

### Architecture

```
Browser (xterm.js)
  │
  ├── WS /ws/terminal  ──► cyberterminalbackend ──► kubectl exec → toolbox-0
  └── WS /ws/metrics   ──► cyberterminalbackend ──► CoreV1Api + metrics-server
```

---

## Project Structure

```
cyberpunkterm/
├── frontend/                        # Vite + React app
│   └── src/App.jsx                  # xterm.js terminal + metrics UI
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
            ├── deployment.yaml      # Backend Deployment
            ├── service.yaml         # ClusterIP :8000
            ├── serviceaccount.yaml
            ├── clusterrole.yaml     # pods/exec + metrics RBAC
            ├── clusterrolebinding.yaml
            ├── toolbox-statefulset.yaml
            └── toolbox-service.yaml # Headless service
```

---

## Prerequisites

- Docker
- Kubernetes cluster (local: [kind](https://kind.sigs.k8s.io/) / [minikube](https://minikube.sigs.k8s.io/))
- Helm v3
- Node.js ≥ 20 (frontend dev only)
- [metrics-server](https://github.com/kubernetes-sigs/metrics-server) installed in the cluster (for CPU/mem metrics)

---

## Quick Start

### 1. Build & push images

```bash
# Toolbox user shell
docker build -t <your-registry>/cyberpunkterm-toolbox:0.1.0 backend/toolbox/
docker push <your-registry>/cyberpunkterm-toolbox:0.1.0

# Backend WebSocket bridge
docker build -t <your-registry>/cyberpunkterm-backend:0.1.0 backend/cyberterminalbackend/
docker push <your-registry>/cyberpunkterm-backend:0.1.0
```

### 2. Deploy with Helm

```bash
helm install cyberterm backend/helm/cyberpunkterm \
  --namespace cyberterm \
  --create-namespace \
  --set backend.image.repository=<your-registry>/cyberpunkterm-backend \
  --set toolbox.image.repository=<your-registry>/cyberpunkterm-toolbox
```

### 3. Port-forward the backend

```bash
kubectl port-forward svc/cyberterm-cyberpunkterm-backend 8000:8000 -n cyberterm
```

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
# Connect: namespace=cyberterm  pod=toolbox-0
```

---

## Configuration

Key `values.yaml` options (override with `--set` or `-f my-values.yaml`):

| Key | Default | Description |
|---|---|---|
| `backend.image.tag` | `0.1.0` | Backend image tag |
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
| `0.1.0` | `0.1.0` | Initial release |

Bump `version` in `Chart.yaml` for chart-only changes; bump `appVersion` when the container images change.

---

## Local Dev Without a Cluster

Set `KUBECONFIG` to point to your kubeconfig and run the backend directly:

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
