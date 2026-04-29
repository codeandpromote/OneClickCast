import { useEffect, useState } from "react";
import type { ViewerStats } from "@oneclickcast/shared";

type Status = "idle" | "starting" | "active" | "error";

interface SessionInfo {
  active: boolean;
  shareLink?: string;
  viewerCount: number;
  viewerStats: ViewerStats[];
}

const STATS_POLL_MS = 1000;

export function Popup() {
  const [status, setStatus] = useState<Status>("idle");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewerStats, setViewerStats] = useState<ViewerStats[]>([]);
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
      } else {
        setStatus((s) => (s === "starting" ? s : "idle"));
        setShareLink(null);
        setViewerCount(0);
        setViewerStats([]);
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

  const stopSharing = async () => {
    await chrome.runtime.sendMessage({ type: "STOP_SHARE" });
    setStatus("idle");
    setShareLink(null);
    setViewerCount(0);
    setViewerStats([]);
  };

  const copyLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
        <button
          onClick={startSharing}
          className="bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white font-semibold py-3 rounded-lg transition shadow-sm"
        >
          Start Sharing
        </button>
      )}

      {status === "starting" && (
        <div className="text-center text-sm text-surface-muted py-3">
          Pick what to share…
        </div>
      )}

      {status === "active" && shareLink && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live · {viewerCount} viewer{viewerCount === 1 ? "" : "s"}
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-surface-muted mb-1">Share link</p>
            <p className="font-mono text-xs text-surface-dark break-all">
              {shareLink}
            </p>
          </div>

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
                Connection quality
              </p>
              {viewerStats.map((v) => (
                <ViewerStatRow key={v.viewerId} stats={v} />
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
        v0.2.0 · No install needed for viewers
      </footer>
    </div>
  );
}

function ViewerStatRow({ stats }: { stats: ViewerStats }) {
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

  return (
    <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="font-mono text-surface-dark">{shortId}</span>
      </div>
      <div className="flex items-center gap-3 text-surface-muted">
        <span>{bitrate}</span>
        <span>{stats.rttMs}ms</span>
        <span>{stats.packetLossPct}% loss</span>
      </div>
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
