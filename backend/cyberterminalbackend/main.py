"""
cyberterminalbackend/main.py
────────────────────────────
FastAPI backend for CyberpunkTerm.

WebSocket endpoints
───────────────────
  WS /ws/terminal?ns=<ns>&pod=<pod>[&container=<c>]
      Bidirectional PTY proxy via kubectl exec.
      • Binary frames  → forwarded verbatim to the pod stdin
      • "resize" JSON  → SIGWINCH sent to the exec'd process
      • pod stdout/stderr → sent as binary frames to the client

  WS /ws/metrics?ns=<ns>&pod=<pod>
      Server-push JSON every ~5 s:
        { timestamp, phase, restarts, node, cpu_m, mem_bytes, rx_bytes, tx_bytes }

REST
────
  GET /healthz   → {"ok": true}

Auth / RBAC
───────────
  Reads in-cluster ServiceAccount token by default.
  Set KUBECONFIG env var to use a kubeconfig file (local dev).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from kubernetes import client as k8s_client, config as k8s_config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream as k8s_stream
import uvicorn

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("cyberterminalbackend")

# ─── Kubernetes config ─────────────────────────────────────────────────────────
def _load_k8s_config() -> None:
    kubeconfig = os.getenv("KUBECONFIG")
    if kubeconfig:
        log.info("Loading kubeconfig from KUBECONFIG env: %s", kubeconfig)
        k8s_config.load_kube_config(config_file=kubeconfig)
    else:
        try:
            k8s_config.load_incluster_config()
            log.info("Loaded in-cluster Kubernetes config")
        except k8s_config.ConfigException:
            log.warning("In-cluster config not found; falling back to default kubeconfig")
            k8s_config.load_kube_config()


_load_k8s_config()

# ─── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="CyberpunkTerm Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


# ─── /ws/terminal ─────────────────────────────────────────────────────────────
@app.websocket("/ws/terminal")
async def ws_terminal(
    websocket: WebSocket,
    ns: str = Query("default"),
    pod: str = Query(...),
    container: Optional[str] = Query(None),
):
    """
    Proxy a PTY session into a Kubernetes pod via exec.

    Frame protocol (client → server):
      • Raw bytes           → stdin for the exec'd process
      • UTF-8 JSON string   → control frame, e.g. {"type":"resize","cols":220,"rows":50}

    Frame protocol (server → client):
      • Binary frames       → stdout / stderr from the exec'd process
    """
    await websocket.accept()
    log.info("terminal connect  ns=%s pod=%s container=%s", ns, pod, container)

    core_v1 = k8s_client.CoreV1Api()

    exec_kwargs: dict = dict(
        namespace=ns,
        name=pod,
        command=["/bin/sh"],
        stderr=True,
        stdin=True,
        stdout=True,
        tty=True,
        _preload_content=False,
    )
    if container:
        exec_kwargs["container"] = container

    try:
        ws_exec = k8s_stream(
            core_v1.connect_get_namespaced_pod_exec,
            **exec_kwargs,
        )
    except ApiException as exc:
        msg = f"[!] kubectl exec failed: {exc.status} {exc.reason}"
        log.error(msg)
        await websocket.send_text(msg)
        await websocket.close(1011)
        return

    loop = asyncio.get_event_loop()

    async def _read_from_pod():
        """Read stdout/stderr from the exec stream and forward to the browser."""
        try:
            while ws_exec.is_open():
                # update() is blocking; run in thread pool to avoid blocking the event loop
                await loop.run_in_executor(None, ws_exec.update, 1)
                if ws_exec.peek_stdout():
                    data = ws_exec.read_stdout()
                    if data:
                        await websocket.send_bytes(data.encode() if isinstance(data, str) else data)
                if ws_exec.peek_stderr():
                    data = ws_exec.read_stderr()
                    if data:
                        await websocket.send_bytes(data.encode() if isinstance(data, str) else data)
        except Exception as exc:
            log.debug("_read_from_pod ended: %s", exc)

    # Start reading pod output in background
    read_task = asyncio.create_task(_read_from_pod())

    try:
        while True:
            raw = await websocket.receive()

            # WebSocket can send bytes or text
            if "bytes" in raw and raw["bytes"] is not None:
                data = raw["bytes"]
                # Forward raw bytes as stdin
                if ws_exec.is_open():
                    ws_exec.write_stdin(data)
            elif "text" in raw and raw["text"] is not None:
                text = raw["text"]
                # Try to parse as a control frame
                try:
                    frame = json.loads(text)
                    if frame.get("type") == "resize":
                        cols = int(frame.get("cols", 80))
                        rows = int(frame.get("rows", 24))
                        if ws_exec.is_open():
                            ws_exec.write_channel(
                                4,  # channel 4 = resize channel in k8s exec protocol
                                json.dumps({"Width": cols, "Height": rows}),
                            )
                except (json.JSONDecodeError, TypeError):
                    # Not JSON — treat as raw stdin text
                    if ws_exec.is_open():
                        ws_exec.write_stdin(text.encode())
    except WebSocketDisconnect:
        log.info("terminal disconnect  ns=%s pod=%s", ns, pod)
    except Exception as exc:
        log.warning("terminal error: %s", exc)
    finally:
        read_task.cancel()
        try:
            ws_exec.close()
        except Exception:
            pass


# ─── /ws/metrics ──────────────────────────────────────────────────────────────
_METRICS_INTERVAL = float(os.getenv("METRICS_INTERVAL_SECONDS", "5"))


def _safe_int(val, fallback=None):
    try:
        return int(val)
    except (TypeError, ValueError):
        return fallback


def _parse_cpu_millicores(cpu_str: str | None) -> int | None:
    """Convert k8s CPU quantity string to millicores int."""
    if not cpu_str:
        return None
    if cpu_str.endswith("m"):
        return _safe_int(cpu_str[:-1])
    try:
        return int(float(cpu_str) * 1000)
    except (TypeError, ValueError):
        return None


def _parse_mem_bytes(mem_str: str | None) -> int | None:
    """Convert k8s memory quantity string to bytes int."""
    if not mem_str:
        return None
    suffixes = {
        "Ki": 1024, "Mi": 1024**2, "Gi": 1024**3,
        "Ti": 1024**4, "Pi": 1024**5, "Ei": 1024**6,
        "K": 1000, "M": 1000**2, "G": 1000**3,
        "T": 1000**4, "P": 1000**5, "E": 1000**6,
    }
    for suffix, factor in suffixes.items():
        if mem_str.endswith(suffix):
            return _safe_int(mem_str[: -len(suffix)], 0) * factor
    return _safe_int(mem_str)


async def _collect_metrics(ns: str, pod: str) -> dict:
    """Collect pod phase/restarts/node + metrics-server cpu/mem."""
    core_v1 = k8s_client.CoreV1Api()
    custom = k8s_client.CustomObjectsApi()
    loop = asyncio.get_event_loop()

    result: dict = {
        "timestamp": time.strftime("%H:%M:%S", time.gmtime()),
        "phase": None,
        "restarts": None,
        "node": None,
        "cpu_m": None,
        "mem_bytes": None,
        "rx_bytes": None,
        "tx_bytes": None,
    }

    # ── Pod core info ─────────────────────────────────────────────────────────
    try:
        pod_obj = await loop.run_in_executor(
            None, lambda: core_v1.read_namespaced_pod(name=pod, namespace=ns)
        )
        result["phase"] = getattr(pod_obj.status, "phase", None)
        result["node"] = getattr(pod_obj.spec, "node_name", None)

        # Sum restarts across all containers
        container_statuses = getattr(pod_obj.status, "container_statuses", None) or []
        result["restarts"] = sum(
            getattr(cs, "restart_count", 0) or 0 for cs in container_statuses
        )
    except ApiException as exc:
        log.debug("metrics: pod read failed: %s", exc)

    # ── Metrics-server CPU / Mem ───────────────────────────────────────────────
    try:
        pod_metrics = await loop.run_in_executor(
            None,
            lambda: custom.get_namespaced_custom_object(
                group="metrics.k8s.io",
                version="v1beta1",
                namespace=ns,
                plural="pods",
                name=pod,
            ),
        )
        containers = pod_metrics.get("containers", [])
        total_cpu_m = 0
        total_mem = 0
        for c in containers:
            usage = c.get("usage", {})
            total_cpu_m += _parse_cpu_millicores(usage.get("cpu")) or 0
            total_mem += _parse_mem_bytes(usage.get("memory")) or 0
        result["cpu_m"] = total_cpu_m or None
        result["mem_bytes"] = total_mem or None
    except ApiException:
        pass  # metrics-server not installed → leave as None
    except Exception as exc:
        log.debug("metrics: metrics-server error: %s", exc)

    return result


@app.websocket("/ws/metrics")
async def ws_metrics(
    websocket: WebSocket,
    ns: str = Query("default"),
    pod: str = Query(...),
    container: Optional[str] = Query(None),
):
    """Stream live pod metrics as JSON every METRICS_INTERVAL_SECONDS."""
    await websocket.accept()
    log.info("metrics connect  ns=%s pod=%s", ns, pod)

    try:
        while True:
            payload = await _collect_metrics(ns, pod)
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(_METRICS_INTERVAL)
    except WebSocketDisconnect:
        log.info("metrics disconnect  ns=%s pod=%s", ns, pod)
    except Exception as exc:
        log.warning("metrics error: %s", exc)


# ─── Entrypoint ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=False,
        log_level="info",
    )
