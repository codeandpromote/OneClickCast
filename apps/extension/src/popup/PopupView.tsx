import { useEffect, useState } from "react";
import type { ViewerStats, ViewerEngagement } from "@oneclickcast/shared";

type Status = "idle" | "starting" | "active" | "error";

interface SessionInfo {
  active: boolean;
  mode?: "any" | "tab";
  shareLink?: string;
  viewerCount: number;
  viewerStats: ViewerStats[];
  engagement: ViewerEngagement[];
  micEnabled: boolean;
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
  const [controlSupported, setControlSupported] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [tabTitle, setTabTitle] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

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
      const res = (await chrome.runtime.sendMessage({
        type: "START_SHARE",
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

          <button
            onClick={toggleMic}
            disabled={micPending}
            className={`w-full text-sm font-medium py-2 rounded-lg transition flex items-center justify-center gap-2 border ${
              micEnabled
                ? "bg-brand-600 hover:bg-brand-700 border-brand-600 text-white"
                : "bg-white hover:bg-slate-50 border-slate-300 text-surface-dark"
            } ${micPending ? "opacity-60 cursor-wait" : ""}`}
          >
            <MicIcon active={micEnabled} />
            {micPending
              ? "Switching…"
              : micEnabled
                ? "Microphone on"
                : "Add microphone"}
          </button>

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
        v0.4.0 · No install needed for viewers
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
