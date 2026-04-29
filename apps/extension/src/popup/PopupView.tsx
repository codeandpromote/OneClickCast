import { useEffect, useState } from "react";
import type { ViewerStats, ViewerEngagement } from "@oneclickcast/shared";

type Status = "idle" | "starting" | "active" | "error";

interface AuthUser {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
}

interface AuthState {
  apiKey: string;
  user: AuthUser;
}

interface SessionInfo {
  active: boolean;
  mode?: "any" | "tab";
  shareLink?: string;
  viewerCount: number;
  viewerStats: ViewerStats[];
  engagement: ViewerEngagement[];
  micEnabled: boolean;
  projectorMode: boolean;
  recording: boolean;
  recordingElapsedMs: number;
  lastRecording?: {
    filename: string;
    sizeBytes: number;
    durationMs: number;
    finishedAt: number;
  };
  controlSupported: boolean;
  controlEnabled: boolean;
  sharedTabTitle?: string;
}

const STATS_POLL_MS = 1000;

export function Popup() {
  const [status, setStatus] = useState<Status>("idle");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewerStats, setViewerStats] = useState<ViewerStats[]>([]);
  const [engagement, setEngagement] = useState<ViewerEngagement[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [projectorMode, setProjectorMode] = useState(false);
  const [projectorPending, setProjectorPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingPending, setRecordingPending] = useState(false);
  const [lastRecording, setLastRecording] = useState<
    SessionInfo["lastRecording"] | undefined
  >();
  const [controlSupported, setControlSupported] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [tabTitle, setTabTitle] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [connectPending, setConnectPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_AUTH" }).then((res) => {
      const a = (res as { auth: AuthState | null } | undefined)?.auth;
      if (a) setAuthUser(a.user);
    });
  }, []);

  const openSignIn = async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_SIGN_IN" });
  };

  const connectKey = async () => {
    if (!keyInput.trim() || connectPending) return;
    setConnectPending(true);
    setAuthError(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "CONNECT_KEY",
        key: keyInput.trim(),
      })) as { ok: boolean; user?: AuthUser; error?: string };
      if (res?.ok && res.user) {
        setAuthUser(res.user);
        setKeyInput("");
      } else {
        setAuthError(res?.error ?? "Failed to connect");
      }
    } finally {
      setConnectPending(false);
    }
  };

  const signOut = async () => {
    await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
    setAuthUser(null);
  };

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      const res = (await chrome.runtime.sendMessage({
        type: "GET_SESSION_STATE",
      })) as SessionInfo | undefined;
      if (!alive || !res) return;
      if (res.active) {
        setStatus((s) => (s === "starting" ? s : "active"));
        setShareLink(res.shareLink ?? null);
        setViewerCount(res.viewerCount ?? 0);
        setViewerStats(res.viewerStats ?? []);
        setEngagement(res.engagement ?? []);
        setMicEnabled(res.micEnabled === true);
        setProjectorMode(res.projectorMode === true);
        setRecording(res.recording === true);
        setRecordingElapsedMs(res.recordingElapsedMs ?? 0);
        setLastRecording(res.lastRecording);
        setControlSupported(res.controlSupported === true);
        setControlEnabled(res.controlEnabled === true);
        setTabTitle(res.sharedTabTitle);
      } else {
        setStatus((s) => (s === "starting" ? s : "idle"));
        setShareLink(null);
        setViewerCount(0);
        setViewerStats([]);
        setEngagement([]);
        setMicEnabled(false);
        setProjectorMode(false);
        setRecording(false);
        setRecordingElapsedMs(0);
        setLastRecording(res?.lastRecording);
        setControlSupported(false);
        setControlEnabled(false);
        setTabTitle(undefined);
      }
    };

    refresh();
    const id = setInterval(refresh, STATS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const startSharing = async () => {
    setStatus("starting");
    setError(null);
    try {
      // Show the desktopCapture picker from the popup context. Calling this
      // from the service worker in MV3 is unreliable because Chrome
      // doesn't treat SW-handled messages as carrying a user gesture.
      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.desktopCapture.chooseDesktopMedia(
          ["screen", "window", "tab", "audio"],
          (id) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr) {
              reject(new Error(lastErr.message));
            } else if (!id) {
              reject(new Error("Capture cancelled"));
            } else {
              resolve(id);
            }
          },
        );
      });

      const res = (await chrome.runtime.sendMessage({
        type: "START_SHARE",
        streamId,
      })) as { shareLink?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      if (res?.shareLink) {
        setShareLink(res.shareLink);
        setStatus("active");
      } else {
        setStatus("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
      setStatus("error");
    }
  };

  const startTabSharing = async () => {
    setStatus("starting");
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) throw new Error("Could not find an active tab");
      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        throw new Error("Cannot share Chrome system tabs");
      }

      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId(
          { targetTabId: tab.id! },
          (streamId) => {
            const err = chrome.runtime.lastError;
            if (err || !streamId)
              reject(new Error(err?.message ?? "No stream id"));
            else resolve(streamId);
          },
        );
      });

      const res = (await chrome.runtime.sendMessage({
        type: "START_TAB_SHARE",
        streamId,
        tabId: tab.id,
        tabTitle: tab.title,
      })) as { shareLink?: string; error?: string };

      if (res?.error) throw new Error(res.error);
      if (res?.shareLink) {
        setShareLink(res.shareLink);
        setStatus("active");
      } else {
        setStatus("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start tab share");
      setStatus("error");
    }
  };

  const stopSharing = async () => {
    await chrome.runtime.sendMessage({ type: "STOP_SHARE" });
    setStatus("idle");
    setShareLink(null);
    setViewerCount(0);
    setViewerStats([]);
    setEngagement([]);
    setMicEnabled(false);
    setProjectorMode(false);
    setRecording(false);
    setRecordingElapsedMs(0);
    setControlEnabled(false);
    setControlSupported(false);
    setTabTitle(undefined);
  };

  const copyLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleMic = async () => {
    if (micPending) return;
    setMicPending(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "TOGGLE_MIC",
      })) as { ok: boolean; micEnabled?: boolean; error?: string };
      if (res?.ok) setMicEnabled(res.micEnabled === true);
      else if (res?.error) setError(res.error);
    } finally {
      setMicPending(false);
    }
  };

  const toggleRecording = async () => {
    if (recordingPending) return;
    setRecordingPending(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "TOGGLE_RECORDING",
      })) as { ok: boolean; recording?: boolean; error?: string };
      if (res?.ok) setRecording(res.recording === true);
      else if (res?.error) setError(res.error);
    } finally {
      setRecordingPending(false);
    }
  };

  const toggleProjector = async () => {
    if (projectorPending) return;
    setProjectorPending(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "TOGGLE_PROJECTOR_MODE",
      })) as { ok: boolean; projectorMode?: boolean; error?: string };
      if (res?.ok) setProjectorMode(res.projectorMode === true);
      else if (res?.error) setError(res.error);
    } finally {
      setProjectorPending(false);
    }
  };

  const toggleControl = async () => {
    if (controlPending) return;
    setControlPending(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "TOGGLE_REMOTE_CONTROL",
      })) as { ok: boolean; controlEnabled?: boolean; error?: string };
      if (res?.ok) setControlEnabled(res.controlEnabled === true);
      else if (res?.error) setError(res.error);
    } finally {
      setControlPending(false);
    }
  };

  const watchingCount = engagement.filter((e) => e.state === "watching").length;
  const awayCount = engagement.filter((e) => e.state !== "watching").length;

  return (
    <div className="flex flex-col p-5 gap-4">
      <header className="flex items-center gap-2">
        <Logo />
        <div>
          <h1 className="text-base font-semibold text-surface-dark leading-tight">
            OneClickCast
          </h1>
          <p className="text-xs text-surface-muted">
            Share your screen instantly
          </p>
        </div>
      </header>

      <div className="h-px bg-slate-200" />

      <AuthSection
        user={authUser}
        keyInput={keyInput}
        onKeyInput={setKeyInput}
        onOpenSignIn={openSignIn}
        onConnect={connectKey}
        onSignOut={signOut}
        connectPending={connectPending}
        error={authError}
      />

      <div className="h-px bg-slate-200" />

      {status === "idle" && (
        <div className="flex flex-col gap-2">
          <button
            onClick={startSharing}
            className="bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white font-semibold py-3 rounded-lg transition shadow-sm"
          >
            Start Sharing
          </button>
          <button
            onClick={startTabSharing}
            className="bg-white border border-brand-200 hover:bg-brand-50 text-brand-700 text-sm font-medium py-2.5 rounded-lg transition"
          >
            Share active tab (with control)
          </button>
          <p className="text-[10px] text-surface-muted text-center mt-1">
            Tab sharing lets viewers click & type in your shared tab.
          </p>
        </div>
      )}

      {status === "starting" && (
        <div className="text-center text-sm text-surface-muted py-3">
          Pick what to share…
        </div>
      )}

      {status === "active" && shareLink && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-2 text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live · {viewerCount} viewer{viewerCount === 1 ? "" : "s"}
            </div>
            {viewerCount > 0 && (
              <div className="text-surface-muted">
                {watchingCount} watching
                {awayCount > 0 && (
                  <span className="text-amber-600"> · {awayCount} away</span>
                )}
              </div>
            )}
          </div>

          {tabTitle && (
            <div className="text-[11px] text-surface-muted truncate">
              Sharing tab: <span className="text-surface-dark">{tabTitle}</span>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-surface-muted mb-1">Share link</p>
            <p className="font-mono text-xs text-surface-dark break-all">
              {shareLink}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={toggleMic}
              disabled={micPending}
              title="Add your microphone audio to the share"
              className={`text-xs font-medium py-2 rounded-lg transition flex items-center justify-center gap-1 border ${
                micEnabled
                  ? "bg-brand-600 hover:bg-brand-700 border-brand-600 text-white"
                  : "bg-white hover:bg-slate-50 border-slate-300 text-surface-dark"
              } ${micPending ? "opacity-60 cursor-wait" : ""}`}
            >
              <MicIcon active={micEnabled} />
              {micPending ? "…" : "Mic"}
            </button>
            <button
              onClick={toggleProjector}
              disabled={projectorPending}
              title="Boosts bitrate to 8 Mbps and prefers H.264 — best for video clips"
              className={`text-xs font-medium py-2 rounded-lg transition flex items-center justify-center gap-1 border ${
                projectorMode
                  ? "bg-accent-500 hover:bg-accent-600 border-accent-500 text-white"
                  : "bg-white hover:bg-slate-50 border-slate-300 text-surface-dark"
              } ${projectorPending ? "opacity-60 cursor-wait" : ""}`}
            >
              <ProjectorIcon active={projectorMode} />
              {projectorPending ? "…" : "Projector"}
            </button>
            <button
              onClick={toggleRecording}
              disabled={recordingPending}
              title="Record this session to a WebM file on your computer"
              className={`text-xs font-medium py-2 rounded-lg transition flex items-center justify-center gap-1 border ${
                recording
                  ? "bg-red-600 hover:bg-red-700 border-red-600 text-white"
                  : "bg-white hover:bg-slate-50 border-slate-300 text-surface-dark"
              } ${recordingPending ? "opacity-60 cursor-wait" : ""}`}
            >
              <RecordIcon active={recording} />
              {recordingPending
                ? "…"
                : recording
                  ? formatElapsed(recordingElapsedMs)
                  : "Record"}
            </button>
          </div>

          {recording && (
            <div className="flex items-center gap-2 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
              Recording locally · will download as WebM when you stop
            </div>
          )}

          {!recording && lastRecording && (
            <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 leading-snug">
              Saved {lastRecording.filename} ·{" "}
              {formatBytes(lastRecording.sizeBytes)} ·{" "}
              {formatElapsed(lastRecording.durationMs)}
            </div>
          )}

          {controlSupported && (
            <>
              <button
                onClick={toggleControl}
                disabled={controlPending}
                className={`w-full text-sm font-medium py-2 rounded-lg transition flex items-center justify-center gap-2 border ${
                  controlEnabled
                    ? "bg-amber-500 hover:bg-amber-600 border-amber-500 text-white"
                    : "bg-white hover:bg-slate-50 border-slate-300 text-surface-dark"
                } ${controlPending ? "opacity-60 cursor-wait" : ""}`}
              >
                <CursorIcon />
                {controlPending
                  ? "Switching…"
                  : controlEnabled
                    ? "Viewers can control · click to stop"
                    : "Allow viewer control"}
              </button>
              {controlEnabled && (
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                  Chrome shows a yellow banner on the shared tab while remote
                  control is on. Anything viewers type will go into your tab.
                </p>
              )}
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={copyLink}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2 rounded-lg transition"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={stopSharing}
              className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-surface-dark text-sm font-medium py-2 rounded-lg transition"
            >
              Stop
            </button>
          </div>

          {viewerStats.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <p className="text-[10px] uppercase tracking-wide text-surface-muted font-semibold">
                Viewers
              </p>
              {viewerStats.map((v) => (
                <ViewerRow
                  key={v.viewerId}
                  stats={v}
                  engagement={engagement.find((e) => e.viewerId === v.viewerId)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      <footer className="mt-auto text-[10px] text-surface-muted text-center pt-2">
        v0.7.0 · No install needed for viewers
      </footer>
    </div>
  );
}

function ViewerRow({
  stats,
  engagement,
}: {
  stats: ViewerStats;
  engagement?: ViewerEngagement;
}) {
  const dotClass =
    stats.quality === "good"
      ? "bg-emerald-500"
      : stats.quality === "fair"
        ? "bg-amber-500"
        : stats.quality === "poor"
          ? "bg-orange-500"
          : "bg-red-500";

  const shortId = stats.viewerId.slice(0, 6);
  const bitrate =
    stats.bitrateKbps >= 1000
      ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps`
      : `${stats.bitrateKbps} kbps`;

  const engaged = !engagement || engagement.state === "watching";

  return (
    <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="font-mono text-surface-dark">{shortId}</span>
        <EngagementBadge engaged={engaged} state={engagement?.state} />
      </div>
      <div className="flex items-center gap-3 text-surface-muted">
        <span>{bitrate}</span>
        <span>{stats.rttMs}ms</span>
        <span>{stats.packetLossPct}% loss</span>
      </div>
    </div>
  );
}

function EngagementBadge({
  engaged,
  state,
}: {
  engaged: boolean;
  state?: "watching" | "tabbed-away" | "minimized";
}) {
  if (engaged) {
    return (
      <span className="text-emerald-600 text-[10px]" title="Watching">
        ●
      </span>
    );
  }
  return (
    <span
      className="text-amber-600 text-[10px]"
      title={state === "minimized" ? "Window minimized" : "Tabbed away"}
    >
      zZ
    </span>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="13"
        rx="3"
        fill={active ? "currentColor" : "none"}
      />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M5 3l14 6-6 2-2 6L5 3z" />
    </svg>
  );
}

function ProjectorIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function RecordIcon({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="8"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function AuthSection({
  user,
  keyInput,
  onKeyInput,
  onOpenSignIn,
  onConnect,
  onSignOut,
  connectPending,
  error,
}: {
  user: AuthUser | null;
  keyInput: string;
  onKeyInput: (s: string) => void;
  onOpenSignIn: () => void;
  onConnect: () => void;
  onSignOut: () => void;
  connectPending: boolean;
  error: string | null;
}) {
  if (user) {
    const display = user.full_name || user.email || "Connected";
    const initial = display.charAt(0).toUpperCase();
    return (
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt=""
              className="w-6 h-6 rounded-full"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold flex items-center justify-center">
              {initial}
            </div>
          )}
          <div className="flex flex-col leading-tight">
            <span className="text-surface-dark font-medium truncate max-w-[180px]">
              {display}
            </span>
            <span className="text-surface-muted text-[10px]">
              Sessions saved to dashboard
            </span>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="text-surface-muted hover:text-surface-dark transition"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-surface-muted leading-snug">
        Sign in to track your share history. Otherwise sessions stay
        anonymous.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Paste key here"
          value={keyInput}
          onChange={(e) => onKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConnect();
          }}
          className="flex-1 text-xs font-mono bg-white border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
        />
        <button
          onClick={onConnect}
          disabled={connectPending || !keyInput.trim()}
          className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connectPending ? "…" : "Connect"}
        </button>
      </div>
      <button
        onClick={onOpenSignIn}
        className="text-xs text-brand-600 hover:text-brand-700 transition self-start"
      >
        Get a key from the dashboard →
      </button>
      {error && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}

function Logo() {
  return (
    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center shadow-sm">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 5L19 12L8 19V5Z" fill="white" />
      </svg>
    </div>
  );
}
