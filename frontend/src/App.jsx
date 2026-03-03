import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./cyberpunk.css";

// In Docker: nginx proxies /ws/* → backend in-cluster.
//   VITE_WS_BASE is empty → derive from the current page's host (same-origin).
// Local dev: VITE_WS_BASE is unset → falls back to ws://localhost:8000.
const WS_BASE = import.meta.env.VITE_WS_BASE !== undefined && import.meta.env.VITE_WS_BASE !== ""
  ? import.meta.env.VITE_WS_BASE
  : (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:8000");

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

const DEFAULT_METRICS = {
  timestamp: null, phase: "—", restarts: "—", node: "—",
  cpu_m: null, mem_bytes: null, rx_bytes: null, tx_bytes: null,
};

// ── TerminalPane ──────────────────────────────────────────────────────────────
// Always mounted; hidden via CSS when not active so xterm state is preserved.
function TerminalPane({ tabId, target, isActive, onStatus }) {
  const mountRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  // Init xterm once on mount
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
    term.open(mountRef.current);
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

  // Re-fit when this tab becomes visible
  useEffect(() => {
    if (isActive) {
      setTimeout(() => fitRef.current?.fit(), 50);
    }
  }, [isActive]);

  // ── Terminal WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!target) {
      onStatus(tabId, { termConnected: false });
      return;
    }
    const { ns, pod, container } = target;
    onStatus(tabId, { termConnected: false });

    const params = new URLSearchParams({ ns, pod, ...(container ? { container } : {}) });
    const ws = new WebSocket(`${WS_BASE}/ws/terminal?${params.toString()}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      onStatus(tabId, { termConnected: true });
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
      onStatus(tabId, { termConnected: false });
      termRef.current?.writeln("\r\n\x1b[33m[-] terminal disconnected\x1b[0m\r\n");
    };

    const inputSub = termRef.current?.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
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
  }, [target?.ns, target?.pod, target?.container, tabId, onStatus]);

  // ── Metrics WebSocket ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!target) {
      onStatus(tabId, { metricsConnected: false, metrics: DEFAULT_METRICS });
      return;
    }
    const { ns, pod, container } = target;
    onStatus(tabId, { metricsConnected: false });

    const params = new URLSearchParams({ ns, pod, ...(container ? { container } : {}) });
    const ws = new WebSocket(`${WS_BASE}/ws/metrics?${params.toString()}`);

    ws.onopen = () => onStatus(tabId, { metricsConnected: true });
    ws.onmessage = (ev) => {
      try { onStatus(tabId, { metrics: JSON.parse(ev.data) }); } catch { /* ignore */ }
    };
    ws.onerror = () => onStatus(tabId, { metricsConnected: false });
    ws.onclose = () => onStatus(tabId, { metricsConnected: false });

    return () => ws.close();
  }, [target?.ns, target?.pod, target?.container, tabId, onStatus]);

  return (
    <div
      className="terminalWrap scanlines"
      style={{ display: isActive ? "flex" : "none", flex: 1, position: "relative" }}
    >
      <div ref={mountRef} className="terminal" />
    </div>
  );
}

// ── Tab factory ───────────────────────────────────────────────────────────────
let _nextId = 1;
function makeTab(ns = "default", pod = "toolbox-0", container = "", autoConnect = false) {
  const id = _nextId++;
  return {
    id,
    nsInput: ns,
    podInput: pod,
    containerInput: container,
    target: autoConnect ? { ns, pod, container } : null,
  };
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [tabs, setTabs] = useState(() => [makeTab("default", "toolbox-0", "", true)]);
  const [activeId, setActiveId] = useState(1);

  // Per-tab statuses: { termConnected, metricsConnected, metrics }
  const [statuses, setStatuses] = useState({});

  const handleStatus = useCallback((tabId, update) => {
    setStatuses(prev => ({
      ...prev,
      [tabId]: {
        termConnected: false,
        metricsConnected: false,
        metrics: DEFAULT_METRICS,
        ...(prev[tabId] ?? {}),
        ...update,
      },
    }));
  }, []);

  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];
  const activeStatus = statuses[activeId] ?? { termConnected: false, metricsConnected: false, metrics: DEFAULT_METRICS };
  const metrics = activeStatus.metrics ?? DEFAULT_METRICS;

  function updateInput(field, value) {
    setTabs(prev => prev.map(t => t.id === activeId ? { ...t, [field]: value } : t));
  }

  function handleConnect() {
    setTabs(prev => prev.map(t => {
      if (t.id !== activeId) return t;
      return { ...t, target: { ns: t.nsInput.trim(), pod: t.podInput.trim(), container: t.containerInput.trim() } };
    }));
  }

  function addTab() {
    const tab = makeTab("default", "", "", false);
    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
  }

  function removeTab(id) {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      if (remaining.length === 0) {
        const fresh = makeTab("default", "toolbox-0", "", false);
        setActiveId(fresh.id);
        return [fresh];
      }
      if (activeId === id) {
        const idx = prev.findIndex(t => t.id === id);
        const next = remaining[Math.max(0, Math.min(idx, remaining.length - 1))];
        setActiveId(next.id);
      }
      return remaining;
    });
    setStatuses(prev => { const s = { ...prev }; delete s[id]; return s; });
  }

  return (
    <div className="page">
      {/* ── Top bar ──────────────────────────────────────────────── */}
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
            <input
              value={activeTab?.nsInput ?? ""}
              onChange={e => updateInput("nsInput", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
            />
          </label>
          <label>
            <span>pod</span>
            <input
              value={activeTab?.podInput ?? ""}
              onChange={e => updateInput("podInput", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
            />
          </label>
          <label>
            <span>container</span>
            <input
              placeholder="optional"
              value={activeTab?.containerInput ?? ""}
              onChange={e => updateInput("containerInput", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
            />
          </label>
          <button className="connectBtn" onClick={handleConnect}>CONNECT</button>
        </div>

        <div className="links">
          <div className={`status ${activeStatus.termConnected ? "ok" : "warn"}`}>
            <div className="dot" />
            {activeStatus.termConnected ? "TERM UP" : "TERM DOWN"}
          </div>
          <div className={`status ${activeStatus.metricsConnected ? "ok" : "warn"}`}>
            <div className="dot" />
            {activeStatus.metricsConnected ? "METRICS UP" : "METRICS DOWN"}
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <div className="main">
        <div className="terminalCard">
          {/* ── Tab bar ──────────────────────────────────────────── */}
          <div className="tabBar">
            {tabs.map(tab => {
              const st = statuses[tab.id];
              const isConn = st?.termConnected;
              const label = tab.target?.pod || "new tab";
              return (
                <div
                  key={tab.id}
                  className={`tab ${tab.id === activeId ? "active" : ""}`}
                  onClick={() => setActiveId(tab.id)}
                  title={tab.target ? `${tab.target.ns}/${tab.target.pod}` : "not connected"}
                >
                  <span className={`tabDot ${isConn ? "tabDot--ok" : "tabDot--off"}`} />
                  <span className="tabLabel">{label}</span>
                  <button
                    className="tabClose"
                    onClick={e => { e.stopPropagation(); removeTab(tab.id); }}
                    title="Close tab"
                  >×</button>
                </div>
              );
            })}
            <button className="addTabBtn" onClick={addTab} title="Open new terminal tab">+</button>
          </div>

          {/* ── Terminal panes — all mounted, only active shown ───── */}
          <div className="terminalBody">
            {tabs.map(tab => (
              <TerminalPane
                key={tab.id}
                tabId={tab.id}
                target={tab.target}
                isActive={tab.id === activeId}
                onStatus={handleStatus}
              />
            ))}
          </div>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────── */}
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
