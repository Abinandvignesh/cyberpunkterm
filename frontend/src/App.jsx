import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./cyberpunk.css";

// In Docker: VITE_WS_BASE is baked in at build time (e.g. ws://cyberpunkterm-backend:8000)
// Local dev:  falls back to ws://localhost:8000
const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://localhost:8000";

function fmtBytes(bytes) {
  if (bytes == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const dp = v >= 10 || i === 0 ? 0 : 1;
  return `${v.toFixed(dp)} ${units[i]}`;
}

function fmtCpuMillicores(m) {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} cores`;
  return `${m} m`;
}

export default function App() {
  const termMountRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  // "staged" fields — only applied when user hits CONNECT
  const [nsInput, setNsInput] = useState("default");
  const [podInput, setPodInput] = useState("toolbox-0");
  const [containerInput, setContainerInput] = useState("");

  // "committed" connection target — changes trigger WS reconnect
  const [target, setTarget] = useState({ ns: "default", pod: "toolbox-0", container: "" });

  const [termConnected, setTermConnected] = useState(false);
  const [metricsConnected, setMetricsConnected] = useState(false);

  const [metrics, setMetrics] = useState({
    timestamp: null,
    phase: "—",
    restarts: "—",
    node: "—",
    cpu_m: null,
    mem_bytes: null,
    rx_bytes: null,
    tx_bytes: null,
  });

  // ── Init terminal once ──────────────────────────────────────────────────────
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#070A12",
        foreground: "#D7FFF1",
        cursor: "#7CFF6B",
        selectionBackground: "rgba(124,255,107,0.25)",
      },
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termMountRef.current);

    // Use rAF so the DOM has fully painted before measuring
    requestAnimationFrame(() => fit.fit());

    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => fitRef.current?.fit();
    window.addEventListener("resize", onResize);

    term.writeln("\x1b[38;2;124;255;107mCYBERTERM\x1b[0m :: k8s exec console");
    term.writeln("\x1b[38;2;94;235;255m[info]\x1b[0m connecting websockets…");
    term.writeln("");

    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
    };
  }, []);

  // ── Terminal WS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const { ns, pod, container } = target;
    setTermConnected(false);

    const params = new URLSearchParams({ ns, pod, ...(container ? { container } : {}) });
    const ws = new WebSocket(`${WS_BASE}/ws/terminal?${params.toString()}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setTermConnected(true);
      termRef.current?.writeln(
        `\r\n\x1b[38;2;94;235;255m[+] attached\x1b[0m ns=${ns} pod=${pod}${container ? " container=" + container : ""}\r\n`
      );
      termRef.current?.focus();
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        termRef.current?.write(new Uint8Array(ev.data));
      } else {
        termRef.current?.write(ev.data);
      }
    };

    ws.onerror = () => termRef.current?.writeln("\r\n\x1b[31m[!] terminal websocket error\x1b[0m\r\n");
    ws.onclose = () => {
      setTermConnected(false);
      termRef.current?.writeln("\r\n\x1b[33m[-] terminal disconnected\x1b[0m\r\n");
    };

    // Forward keyboard input to the backend
    const inputSub = termRef.current?.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Tell the backend whenever the terminal viewport is resized
    const resizeSub = termRef.current?.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    return () => {
      inputSub?.dispose();
      resizeSub?.dispose();
      ws.close();
    };
  }, [target]);

  // ── Metrics WS ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const { ns, pod, container } = target;
    setMetricsConnected(false);

    const params = new URLSearchParams({ ns, pod, ...(container ? { container } : {}) });
    const ws = new WebSocket(`${WS_BASE}/ws/metrics?${params.toString()}`);

    ws.onopen = () => setMetricsConnected(true);
    ws.onmessage = (ev) => {
      try { setMetrics(JSON.parse(ev.data)); } catch { /* ignore */ }
    };
    ws.onerror = () => setMetricsConnected(false);
    ws.onclose = () => setMetricsConnected(false);

    return () => ws.close();
  }, [target]);

  function handleConnect() {
    setTarget({ ns: nsInput.trim(), pod: podInput.trim(), container: containerInput.trim() });
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <div className="logoGlow" />
          <div>
            <div className="brandTitle">CYBERTERM</div>
            <div className="brandSub">terminal + live pod metrics</div>
          </div>
        </div>

        <div className="targets">
          <label>
            <span>namespace</span>
            <input value={nsInput} onChange={(e) => setNsInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleConnect()} />
          </label>
          <label>
            <span>pod</span>
            <input value={podInput} onChange={(e) => setPodInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleConnect()} />
          </label>
          <label>
            <span>container</span>
            <input placeholder="optional" value={containerInput} onChange={(e) => setContainerInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleConnect()} />
          </label>
          <button className="connectBtn" onClick={handleConnect}>CONNECT</button>
        </div>

        <div className="links">
          <div className={`status ${termConnected ? "ok" : "warn"}`}>
            <div className="dot" />
            {termConnected ? "TERM UP" : "TERM DOWN"}
          </div>
          <div className={`status ${metricsConnected ? "ok" : "warn"}`}>
            <div className="dot" />
            {metricsConnected ? "METRICS UP" : "METRICS DOWN"}
          </div>
        </div>
      </div>

      <div className="main">
        <div className="terminalCard">
          <div className="cardHeader">
            <div className="hdrLeft">TERMINAL</div>
            <div className="hdrRight">
              <span className="pill">{target.ns}</span>
              <span className="pill">{target.pod}</span>
              {target.container ? <span className="pill">{target.container}</span> : null}
            </div>
          </div>
          <div className="terminalWrap scanlines">
            <div ref={termMountRef} className="terminal" />
          </div>
        </div>

        <div className="side">
          <div className="metricCard">
            <div className="cardHeader">
              <div className="hdrLeft">LIVE METRICS</div>
              <div className="hdrRight mono">{metrics.timestamp ?? "—"}</div>
            </div>
            <div className="metricGrid">
              <div className="metric">
                <div className="k">phase</div>
                <div className="v">{metrics.phase ?? "—"}</div>
              </div>
              <div className="metric">
                <div className="k">restarts</div>
                <div className="v">{metrics.restarts ?? "—"}</div>
              </div>
              <div className="metric span2">
                <div className="k">node</div>
                <div className="v mono">{metrics.node ?? "—"}</div>
              </div>
              <div className="metric">
                <div className="k">cpu</div>
                <div className="v">{fmtCpuMillicores(metrics.cpu_m)}</div>
              </div>
              <div className="metric">
                <div className="k">memory</div>
                <div className="v">{fmtBytes(metrics.mem_bytes)}</div>
              </div>
              <div className="metric">
                <div className="k">rx</div>
                <div className="v">{fmtBytes(metrics.rx_bytes)}</div>
              </div>
              <div className="metric">
                <div className="k">tx</div>
                <div className="v">{fmtBytes(metrics.tx_bytes)}</div>
              </div>
            </div>
            <div className="divider" />
            <div className="hint mono">
              If cpu/mem show "—", metrics-server isn't installed or the backend metrics endpoint isn't running yet.
            </div>
          </div>

          <div className="metricCard small">
            <div className="cardHeader">
              <div className="hdrLeft">OPS NOTES</div>
              <div className="hdrRight">security</div>
            </div>
            <ul className="alerts">
              <li><span className="tag ok">OK</span> websockets for live stream</li>
              <li><span className="tag warn">WARN</span> restrict pods/exec RBAC</li>
              <li><span className="tag crit">CRIT</span> add auth + audit logging</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bgGrid" />
      <div className="vignette" />
    </div>
  );
}
