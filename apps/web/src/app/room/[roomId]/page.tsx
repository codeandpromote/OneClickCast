"use client";

import { use, useEffect, useRef, useState } from "react";
import { DEFAULT_ROOM_CONFIG } from "@oneclickcast/shared";

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ??
  "wss://oneclickcast-signaling.workers.dev";

type ConnState = "connecting" | "waiting" | "live" | "ended" | "error";

export default function ViewerRoom({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const ws = new WebSocket(`${SIGNALING_URL}/room/${roomId}?role=viewer`);
      wsRef.current = ws;

      const pc = new RTCPeerConnection({
        iceServers: DEFAULT_ROOM_CONFIG.iceServers,
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setState("live");
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "ice-candidate",
              candidate: event.candidate.toJSON(),
            }),
          );
        }
      };

      ws.onopen = () => {
        if (!cancelled) setState("waiting");
        startEngagementHeartbeat(ws);
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "offer": {
            await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(
              JSON.stringify({
                type: "answer",
                sdp: answer.sdp,
                targetId: msg.fromId,
              }),
            );
            break;
          }
          case "ice-candidate":
            if (msg.candidate) {
              await pc.addIceCandidate(msg.candidate);
            }
            break;
          case "presenter-left":
            setState("ended");
            break;
          case "error":
            setErrorMsg(msg.error);
            setState("error");
            break;
        }
      };

      ws.onerror = () => {
        if (!cancelled) {
          setErrorMsg("Connection error");
          setState("error");
        }
      };

      ws.onclose = () => {
        if (!cancelled && state !== "ended") {
          setState("ended");
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      pcRef.current?.close();
      wsRef.current?.close();
    };
  }, [roomId]);

  return (
    <div className="min-h-screen bg-surface-dark text-white flex flex-col">
      <header className="px-4 py-3 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M8 5L19 12L8 19V5Z" />
            </svg>
          </div>
          <span className="font-semibold">OneClickCast</span>
        </div>
        <StatusBadge state={state} />
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        {state === "live" ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            controls={false}
            muted={false}
            className="max-w-full max-h-full rounded-lg shadow-2xl bg-black"
          />
        ) : (
          <div className="text-center">
            {state === "connecting" && <p>Connecting…</p>}
            {state === "waiting" && (
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                  <span className="w-3 h-3 rounded-full bg-accent-500 animate-pulse" />
                </div>
                <p className="text-lg font-medium">Waiting for presenter…</p>
                <p className="text-sm text-white/60 mt-2">
                  Room <span className="font-mono">{roomId}</span>
                </p>
              </>
            )}
            {state === "ended" && (
              <p className="text-white/70">The session has ended.</p>
            )}
            {state === "error" && (
              <p className="text-red-400">
                {errorMsg ?? "Something went wrong"}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; color: string }> = {
    connecting: { label: "Connecting", color: "bg-amber-500" },
    waiting: { label: "Waiting", color: "bg-amber-500" },
    live: { label: "Live", color: "bg-emerald-500" },
    ended: { label: "Ended", color: "bg-slate-500" },
    error: { label: "Error", color: "bg-red-500" },
  };
  const { label, color } = map[state];
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
      {label}
    </div>
  );
}

function startEngagementHeartbeat(ws: WebSocket) {
  const send = (engState: "watching" | "tabbed-away") => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "engagement", state: engState }));
    }
  };
  document.addEventListener("visibilitychange", () => {
    send(document.hidden ? "tabbed-away" : "watching");
  });
  window.addEventListener("focus", () => send("watching"));
  window.addEventListener("blur", () => send("tabbed-away"));
}
