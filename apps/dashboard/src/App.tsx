import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppRecord, DashboardSnapshot, DeploymentRecord } from "@deploythisshit/shared";
import {
  Activity,
  ArrowDownToLine,
  Box,
  Check,
  ChevronRight,
  Circle,
  Cloud,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  MoreHorizontal,
  Network,
  OctagonAlert,
  Play,
  RefreshCcw,
  RotateCcw,
  Server,
  Settings,
  ShieldCheck,
  Square,
  StopCircle,
  Unplug,
  X
} from "lucide-react";
import { DashboardApi } from "./api";

type View = "deployments" | "domains" | "devices" | "server" | "settings";

const navItems: Array<{ id: View; label: string; icon: typeof Box }> = [
  { id: "deployments", label: "Deployments", icon: Box },
  { id: "domains", label: "Domains", icon: Network },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "server", label: "Server", icon: Server },
  { id: "settings", label: "Settings", icon: Settings }
];

function formatRelative(value: string | null): string {
  if (!value) return "Never";
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h`;
}

function StatusMark({ status }: { status: AppRecord["status"] | DeploymentRecord["status"] }) {
  const live = status === "live";
  const active = ["deploying", "loading", "starting", "checking", "routing", "uploaded"].includes(status);
  const failed = status === "failed";
  const Icon = live ? Circle : active ? LoaderCircle : failed ? OctagonAlert : Square;
  return (
    <span className={`status status--${live ? "live" : active ? "active" : failed ? "failed" : "stopped"}`}>
      <Icon aria-hidden="true" size={12} fill={live ? "currentColor" : "none"} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function IconButton({ label, children, onClick, disabled = false }: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim()) onLogin(token.trim());
  };
  return (
    <main className="login-shell">
      <section className="login-sheet" aria-labelledby="login-title">
        <div className="registration-mark" aria-hidden="true">+</div>
        <p className="wordmark">DeployThisShit</p>
        <h1 id="login-title">Open the control manifest.</h1>
        <p className="login-copy">Use the administrator token generated during server setup. It stays in this browser tab and is cleared when you sign out.</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-token">Administrator token</label>
          <input
            id="admin-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste the server token"
            autoFocus
          />
          <button className="button button--primary" type="submit">
            Open dashboard <ChevronRight size={17} aria-hidden="true" />
          </button>
        </form>
        <div className="login-note"><ShieldCheck size={17} /> Served by your own deployment agent.</div>
      </section>
    </main>
  );
}

function SummaryStrip({ snapshot }: { snapshot: DashboardSnapshot }) {
  const live = snapshot.apps.filter((app) => app.status === "live").length;
  const metrics = [
    ["Applications", String(snapshot.apps.length), `${live} live`],
    ["Domains", String(snapshot.apps.length), "public routes"],
    ["Devices", String(snapshot.devices.filter((device) => !device.revokedAt).length), "paired"],
    ["Server", snapshot.server.status === "healthy" ? "Healthy" : "Degraded", `up ${formatUptime(snapshot.server.uptimeSeconds)}`]
  ];
  return (
    <section className="summary-strip" aria-label="Server summary">
      {metrics.map(([label, value, detail]) => (
        <div className="summary-cell" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
      <div className="route-note" aria-hidden="true">BUILD<br />DEPLOY<br />REPEAT</div>
    </section>
  );
}

function ActiveDeployment({ app, deployment, busy, onAction }: {
  app: AppRecord;
  deployment?: DeploymentRecord | undefined;
  busy: string | null;
  onAction: (action: "start" | "stop" | "rollback") => void;
}) {
  const isLive = app.status === "live";
  return (
    <section className={`active-shipment ${app.status === "deploying" ? "active-shipment--moving" : ""}`}>
      <div className="active-title">
        <h2>{app.name}</h2>
        <a href={`https://${app.domain}`} target="_blank" rel="noreferrer">
          {app.domain} <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
      <div className="active-data">
        <span>Status</span>
        <StatusMark status={app.status} />
      </div>
      <div className="active-data">
        <span>Release</span>
        <code>{deployment?.release || app.currentRelease || "—"}</code>
      </div>
      <div className="active-data">
        <span>Updated</span>
        <strong>{formatRelative(app.updatedAt)}</strong>
      </div>
      <div className="active-actions">
        <button
          className={`button ${isLive ? "button--danger" : "button--primary"}`}
          disabled={Boolean(busy)}
          onClick={() => onAction(isLive ? "stop" : "start")}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : isLive ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          {isLive ? "Stop site" : "Start site"}
        </button>
        <button className="button button--secondary" disabled={Boolean(busy)} onClick={() => onAction("rollback")}>
          <RotateCcw size={16} /> Roll back
        </button>
      </div>
    </section>
  );
}

function DeploymentTable({ apps, deployments, selectedId, onSelect, busy, onAction }: {
  apps: AppRecord[];
  deployments: DeploymentRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy: string | null;
  onAction: (app: AppRecord, action: "start" | "stop") => void;
}) {
  const latest = new Map<string, DeploymentRecord>();
  for (const deployment of deployments) if (!latest.has(deployment.appId)) latest.set(deployment.appId, deployment);
  return (
    <section className="register" aria-labelledby="deployment-register-title">
      <header className="section-heading">
        <div>
          <h2 id="deployment-register-title">Deployment register</h2>
          <p>{apps.length} applications routed through this server</p>
        </div>
        <span className="manifest-number">MANIFEST / {new Date().getFullYear()}</span>
      </header>
      {apps.length === 0 ? (
        <div className="empty-state">
          <ArrowDownToLine size={28} />
          <h3>Nothing has shipped yet.</h3>
          <p>Run <code>DeployThisShit</code> inside a local project. Its first healthy release will appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Route</th><th>State</th><th>Release</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {apps.map((app) => {
                const deployment = latest.get(app.id);
                const selected = app.id === selectedId;
                return (
                  <tr key={app.id} className={selected ? "is-selected" : ""} onClick={() => onSelect(app.id)}>
                    <td><button className="row-select" onClick={() => onSelect(app.id)}>{app.name}</button></td>
                    <td><a href={`https://${app.domain}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{app.domain}</a></td>
                    <td><StatusMark status={app.status} /></td>
                    <td><code>{deployment?.release || app.currentRelease || "—"}</code></td>
                    <td>{formatRelative(app.updatedAt)}</td>
                    <td>
                      <button
                        className="table-action"
                        disabled={busy === app.id || app.status === "deploying"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction(app, app.status === "live" ? "stop" : "start");
                        }}
                      >
                        {app.status === "live" ? <Square size={11} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        {app.status === "live" ? "Stop" : "Start"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ServerPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const items = [
    ["Memory", snapshot.server.memoryUsedPercent, "%"],
    ["Load", Math.min(100, Math.round(snapshot.server.loadAverage * 25)), snapshot.server.loadAverage.toFixed(2)],
    ["Disk", snapshot.server.diskUsedPercent || 0, snapshot.server.diskUsedPercent === null ? "Unavailable" : "%"]
  ] as const;
  return (
    <section className="server-panel" aria-labelledby="server-health-title">
      <header>
        <div><h2 id="server-health-title">Server health</h2><StatusMark status={snapshot.server.status === "healthy" ? "live" : "failed"} /></div>
        <code>{snapshot.server.hostname} / {snapshot.server.architecture} / {snapshot.server.containerDriver}</code>
      </header>
      <div className="resource-grid">
        {items.map(([label, value, suffix]) => (
          <div className="resource" key={label}>
            <div><span>{label}</span><strong>{typeof suffix === "string" && suffix !== "%" ? suffix : `${value}${suffix}`}</strong></div>
            <div className="meter"><span style={{ width: `${value}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Inspector({ app, deployments, busy, onClose, onAction, onBasicAuth }: {
  app: AppRecord;
  deployments: DeploymentRecord[];
  busy: string | null;
  onClose: () => void;
  onAction: (action: "start" | "stop" | "rollback") => void;
  onBasicAuth: (input: { enabled: boolean; username?: string; password?: string }) => Promise<void>;
}) {
  const [editingAuth, setEditingAuth] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const releases = deployments.filter((deployment) => deployment.appId === app.id).slice(0, 6);
  const copyDomain = () => void navigator.clipboard.writeText(`https://${app.domain}`);
  return (
    <aside className="inspector" aria-labelledby="inspector-title">
      <header className="inspector-header">
        <span>Site inspector</span>
        <IconButton label="Close inspector" onClick={onClose}><X size={18} /></IconButton>
      </header>
      <div className="inspector-title">
        <div><h2 id="inspector-title">{app.name}</h2><StatusMark status={app.status} /></div>
        <a href={`https://${app.domain}`} target="_blank" rel="noreferrer">{app.domain} <ExternalLink size={13} /></a>
      </div>
      <dl className="facts">
        <div><dt>Route</dt><dd>{app.domain} <IconButton label="Copy domain" onClick={copyDomain}><Copy size={13} /></IconButton></dd></div>
        <div><dt>Release</dt><dd><code>{app.currentRelease || "None"}</code></dd></div>
        <div><dt>Container port</dt><dd><code>{app.containerPort}</code></dd></div>
        <div><dt>Health path</dt><dd><code>{app.healthPath}</code></dd></div>
        <div><dt>HTTP auth</dt><dd>{app.basicAuthEnabled ? "Enabled" : "Disabled"}</dd></div>
      </dl>
      <section className="inspector-actions">
        <h3>Operations</h3>
        <div>
          <button className={app.status === "live" ? "button button--danger" : "button button--primary"} disabled={Boolean(busy)} onClick={() => onAction(app.status === "live" ? "stop" : "start")}>
            {app.status === "live" ? <StopCircle size={16} /> : <Play size={16} />} {app.status === "live" ? "Stop site" : "Start site"}
          </button>
          <button className="button button--secondary" disabled={Boolean(busy)} onClick={() => onAction("rollback")}><RotateCcw size={16} /> Roll back</button>
        </div>
      </section>
      <section className="auth-section">
        <div className="subsection-heading">
          <div><h3>HTTP Basic Auth</h3><p>{app.basicAuthEnabled ? "Traffic is protected before it reaches the container." : "Add a simple gate in front of this site."}</p></div>
          <button className="text-button" onClick={() => setEditingAuth((value) => !value)}>{editingAuth ? "Cancel" : "Edit"}</button>
        </div>
        {editingAuth && (
          <form onSubmit={(event) => {
            event.preventDefault();
            void onBasicAuth(app.basicAuthEnabled ? { enabled: false } : { enabled: true, username, password }).then(() => {
              setEditingAuth(false);
              setPassword("");
            });
          }}>
            {!app.basicAuthEnabled && <>
              <label htmlFor="auth-user">Username</label>
              <input id="auth-user" value={username} onChange={(event) => setUsername(event.target.value)} required />
              <label htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required />
            </>}
            <button className="button button--secondary" type="submit">{app.basicAuthEnabled ? "Disable protection" : "Enable protection"}</button>
          </form>
        )}
      </section>
      <section className="release-list">
        <h3>Recent releases</h3>
        {releases.length === 0 ? <p className="muted">No releases recorded.</p> : releases.map((release) => (
          <div key={release.id}><StatusMark status={release.status} /><code>{release.release}</code><time>{formatRelative(release.createdAt)}</time></div>
        ))}
      </section>
      <footer className="inspector-footer">MANIFEST {app.id.slice(0, 8).toUpperCase()}<br />OPERATE RESPONSIBLY</footer>
    </aside>
  );
}

function DomainsView({ apps }: { apps: AppRecord[] }) {
  return <section className="page-section"><header className="page-title"><h1>Domains</h1><p>Public routes managed for applications on this server.</p></header><div className="record-list">
    {apps.map((app) => <article key={app.id}><Network size={18} /><div><strong>{app.domain}</strong><span>Routes to {app.name} · port {app.hostPort || "—"}</span></div><StatusMark status={app.status} /><a href={`https://${app.domain}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /><span className="sr-only">Open {app.domain}</span></a></article>)}
    {apps.length === 0 && <div className="empty-state"><Network size={28} /><h3>No routes yet.</h3><p>A domain appears after an app is registered from the CLI.</p></div>}
  </div></section>;
}

function DevicesView({ snapshot, api, refresh }: { snapshot: DashboardSnapshot; api: DashboardApi; refresh: () => Promise<void> }) {
  const active = snapshot.devices.filter((device) => !device.revokedAt);
  return <section className="page-section"><header className="page-title"><h1>Connected devices</h1><p>Every CLI has its own revocable credential.</p></header>
    {snapshot.pendingPairings.length > 0 && <section className="pairing-lane"><h2>Waiting for approval</h2>{snapshot.pendingPairings.map((pairing) => <div key={pairing.id}><div><strong>{pairing.code}</strong><span>{pairing.deviceName} · expires {formatRelative(pairing.expiresAt)}</span></div><button className="button button--primary" onClick={() => void api.approvePairing(pairing.id).then(refresh)}><Check size={16} /> Approve device</button></div>)}</section>}
    <div className="record-list">{active.map((device) => <article key={device.id}><MonitorSmartphone size={18} /><div><strong>{device.name}</strong><span>Paired {formatRelative(device.createdAt)} · seen {formatRelative(device.lastSeenAt)}</span></div><button className="text-button text-button--danger" onClick={() => void api.revokeDevice(device.id).then(refresh)}><Unplug size={14} /> Revoke</button></article>)}{active.length === 0 && <div className="empty-state"><MonitorSmartphone size={28} /><h3>No paired devices.</h3><p>Run <code>deploythisshit init</code> to begin pairing.</p></div>}</div>
  </section>;
}

function ServerView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return <section className="page-section"><header className="page-title"><h1>Server</h1><p>The host that builds nothing and runs everything.</p></header><ServerPanel snapshot={snapshot} /><div className="diagnostics"><div><span>Hostname</span><strong>{snapshot.server.hostname}</strong></div><div><span>Platform</span><strong>{snapshot.server.platform} / {snapshot.server.architecture}</strong></div><div><span>Runtime mode</span><strong>{snapshot.server.containerDriver}</strong></div><div><span>Uptime</span><strong>{formatUptime(snapshot.server.uptimeSeconds)}</strong></div></div></section>;
}

function SettingsView({ snapshot, api, refresh }: { snapshot: DashboardSnapshot; api: DashboardApi; refresh: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [zoneId, setZoneId] = useState(snapshot.cloudflare.zoneId || "");
  const [serverIpv4, setServerIpv4] = useState(snapshot.cloudflare.serverIpv4 || "");
  const [saving, setSaving] = useState(false);
  return <section className="page-section"><header className="page-title"><h1>Settings</h1><p>Provider credentials stay encrypted on this server.</p></header><form className="settings-form" onSubmit={(event) => {event.preventDefault();setSaving(true);void api.configureCloudflare({ token, zoneId, serverIpv4 }).then(refresh).finally(() => setSaving(false));}}>
    <div className="settings-heading"><Cloud size={21} /><div><h2>Cloudflare DNS</h2><p>{snapshot.cloudflare.configured ? "Connected. Enter the token again only when rotating credentials." : "Connect a zone-scoped API token with DNS write access."}</p></div><span className={snapshot.cloudflare.configured ? "connection-state connection-state--ok" : "connection-state"}>{snapshot.cloudflare.configured ? "Configured" : "Not configured"}</span></div>
    <label htmlFor="cf-token">API token</label><input id="cf-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={snapshot.cloudflare.configured ? "Enter a replacement token" : "Cloudflare API token"} required />
    <div className="field-row"><div><label htmlFor="cf-zone">Zone ID</label><input id="cf-zone" value={zoneId} onChange={(event) => setZoneId(event.target.value)} required /></div><div><label htmlFor="server-ip">Server IPv4</label><input id="server-ip" value={serverIpv4} onChange={(event) => setServerIpv4(event.target.value)} placeholder="203.0.113.10" required /></div></div>
    <button className="button button--primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />} Verify and save</button>
  </form></section>;
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("dts-admin-token") || "");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [view, setView] = useState<View>("deployments");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => new DashboardApi(token), [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const next = await api.snapshot();
      setSnapshot(next);
      setError(null);
      if (!selectedId && next.apps[0]) setSelectedId(next.apps[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      if (!sessionStorage.getItem("dts-admin-token")) setToken("");
    }
  }, [api, selectedId, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!token) return <Login onLogin={(next) => {sessionStorage.setItem("dts-admin-token", next);setToken(next);}} />;
  if (!snapshot) return <main className="loading-screen"><LoaderCircle className="spin" /><p>Reading the server manifest…</p>{error && <button className="button button--secondary" onClick={() => {sessionStorage.removeItem("dts-admin-token");setToken("");}}>Use another token</button>}</main>;

  const selected = snapshot.apps.find((app) => app.id === selectedId) || null;
  const latestDeployment = selected ? snapshot.deployments.find((item) => item.appId === selected.id) : undefined;
  const act = async (app: AppRecord, action: "start" | "stop" | "rollback") => {
    setBusy(app.id); setError(null);
    try { await api.action(app.id, action); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(null); }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Box size={20} /></span><div><strong>DeployThisShit</strong><span>Ship what works.</span></div></div>
        <nav aria-label="Main navigation">{navItems.map((item) => {const Icon = item.icon;return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === "devices" && snapshot.pendingPairings.length > 0 && <b>{snapshot.pendingPairings.length}</b>}</button>;})}</nav>
        <div className="sidebar-footer"><div className="operator"><span>A</span><div><small>Operator</small><strong>Admin</strong></div></div><button onClick={() => {sessionStorage.removeItem("dts-admin-token");setToken("");}}><LogOut size={17} /> Sign out</button><code>v0.1 / self-hosted</code></div>
      </aside>

      <main className="workspace">
        <header className="topbar"><div><span>Self-hosted deployment control</span><strong>DTS / {snapshot.server.hostname}</strong></div><button className="sync-button" onClick={() => void refresh()}><RefreshCcw size={15} /> Sync manifest</button></header>
        {error && <div className="error-banner" role="alert"><OctagonAlert size={17} /><span>{error}</span><button onClick={() => setError(null)}><X size={16} /><span className="sr-only">Dismiss</span></button></div>}
        {view === "deployments" && <>
          <header className="masthead"><div><h1>Deployments</h1><p>Ship what works.</p></div><div className="masthead-note">SELF-HOSTED<br />APPLICATIONS<br />FOR PEOPLE WHO BUILD.</div></header>
          <SummaryStrip snapshot={snapshot} />
          <div className={`deployment-layout ${selected ? "has-inspector" : ""}`}>
            <div className="deployment-main">
              {selected && <ActiveDeployment app={selected} deployment={latestDeployment} busy={busy} onAction={(action) => void act(selected, action)} />}
              <DeploymentTable apps={snapshot.apps} deployments={snapshot.deployments} selectedId={selectedId} onSelect={setSelectedId} busy={busy} onAction={(app, action) => void act(app, action)} />
              <ServerPanel snapshot={snapshot} />
            </div>
            {selected && (
              <Inspector
                app={selected}
                deployments={snapshot.deployments}
                busy={busy}
                onClose={() => setSelectedId(null)}
                onAction={(action) => void act(selected, action)}
                onBasicAuth={async (input) => {
                  setBusy(selected.id);
                  try {
                    await api.basicAuth(selected.id, input);
                    await refresh();
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            )}
          </div>
        </>}
        {view === "domains" && <DomainsView apps={snapshot.apps} />}
        {view === "devices" && <DevicesView snapshot={snapshot} api={api} refresh={refresh} />}
        {view === "server" && <ServerView snapshot={snapshot} />}
        {view === "settings" && <SettingsView snapshot={snapshot} api={api} refresh={refresh} />}
      </main>
    </div>
  );
}
