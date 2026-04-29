"use client";

import { use, useEffect, useRef, useState } from "react";
import { DEFAULT_ROOM_CONFIG, type IceServer } from "@oneclickcast/shared";

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ??
  "wss://oneclickcast-signaling.workers.dev";

const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const VIEWER_PING_INTERVAL_MS = 25_000;

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
  const iceServersRef = useRef<IceServer[]>(DEFAULT_ROOM_CONFIG.iceServers);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const [state, setState] = useState<ConnState>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    fetchIceServers().then((servers) => {
      iceServersRef.current = servers;
      if (!cancelledRef.current) connect();
    });

    function connect() {
      if (cancelledRef.current) return;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setState("live");
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          console.warn("[viewer] ICE failed; awaiting presenter restart");
        }
      };

      const ws = new WebSocket(`${SIGNALING_URL}/room/${roomId}?role=viewer`);
      wsRef.current = ws;

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
        if (cancelledRef.current) return;
        reconnectAttemptsRef.current = 0;
        if (state !== "live") setState("waiting");
        startPingLoop(ws);
        startEngagementHeartbeat(ws);
      };

      ws.onmessage = async (event) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "offer": {
            await pc.setRemoteDescription({
              type: "offer",
              sdp: msg.sdp as string,
            });
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
              try {
                await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit);
              } catch (err) {
                console.warn("[viewer] ICE candidate failed", err);
              }
            }
            break;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          case "presenter-left":
            cancelledRef.current = true;
            setState("ended");
            cleanup();
            break;
          case "error":
            setErrorMsg((msg.error as string) ?? "Signaling error");
            setState("error");
            break;
        }
      };

      ws.onerror = () => {
        console.warn("[viewer] WebSocket error");
      };

      ws.onclose = () => {
        stopPingLoop();
        try {
          pc.close();
        } catch {}
        if (cancelledRef.current) return;
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (cancelledRef.current || reconnectTimerRef.current) return;
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(
        RECONNECT_INITIAL_DELAY_MS * 2 ** attempt,
        RECONNECT_MAX_DELAY_MS,
      );
      reconnectAttemptsRef.current = attempt + 1;
      console.log(`[viewer] Reconnecting in ${delay}ms`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function startPingLoop(ws: WebSocket) {
      stopPingLoop();
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, VIEWER_PING_INTERVAL_MS);
    }

    function stopPingLoop() {
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    }

    function cleanup() {
      stopPingLoop();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try {
        pcRef.current?.close();
      } catch {}
      try {
        wsRef.current?.close();
      } catch {}
    }

    return () => {
      cancelledRef.current = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const httpUrl =
      SIGNALING_URL.replace(/^ws/, "http").replace(/\/+$/, "") + "/ice-servers";
    const res = await fetch(httpUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { iceServers?: IceServer[] };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers;
    }
  } catch (err) {
    console.warn("[viewer] ICE servers fetch failed, using fallback", err);
  }
  return DEFAULT_ROOM_CONFIG.iceServers;
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
