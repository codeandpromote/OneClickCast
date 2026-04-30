"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ROOM_CONFIG,
  type ControlEvent,
  type IceServer,
} from "@oneclickcast/shared";

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ??
  "wss://oneclickcast-signaling.workers.dev";

const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const VIEWER_PING_INTERVAL_MS = 25_000;
const MOUSE_MOVE_THROTTLE_MS = 40;

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
  const [controlActive, setControlActive] = useState(false);
  const controlActiveRef = useRef(false);

  const sendControl = useCallback((event: ControlEvent) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "control", event }));
    }
  }, []);

  useEffect(() => {
    controlActiveRef.current = controlActive;
  }, [controlActive]);

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
        console.log("[viewer] ontrack fired, kind:", event.track.kind);
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setState("live");
          // Some mobile browsers (especially iOS Safari) refuse autoplay
          // even with the autoPlay attribute. Force-call play() and
          // ignore the rejection - user gesture fallback button below.
          videoRef.current.play().catch((err) => {
            console.warn("[viewer] play() rejected:", err);
          });
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

  // Keyboard capture while control is active
  useEffect(() => {
    if (!controlActive) return;

    const onKey = (e: KeyboardEvent) => {
      if (!controlActiveRef.current) return;
      e.preventDefault();
      const modifiers = computeModifiers(e);
      const action = e.type === "keydown" ? "down" : "up";
      const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
      sendControl({
        kind: "key",
        key: e.key,
        code: e.code,
        action,
        modifiers,
        text: isPrintable && action === "down" ? e.key : undefined,
      });
    };

    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKey, { capture: true });
    };
  }, [controlActive, sendControl]);

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
        <div className="flex items-center gap-3">
          {state === "live" && (
            <button
              onClick={() => setControlActive((v) => !v)}
              className={`text-xs font-medium px-3 py-1 rounded-md transition ${
                controlActive
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "bg-white/10 hover:bg-white/20 text-white"
              }`}
            >
              {controlActive ? "Release control" : "Take control"}
            </button>
          )}
          <StatusBadge state={state} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 relative">
        {state === "live" ? (
          <div className="relative max-w-full max-h-full">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              controls={false}
              onClick={() => videoRef.current?.play().catch(() => {})}
              className="max-w-full max-h-full rounded-lg shadow-2xl bg-black block"
            />
            {controlActive && (
              <ControlOverlay
                videoRef={videoRef}
                sendControl={sendControl}
              />
            )}
          </div>
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
                <p className="text-[10px] text-white/30 mt-6 max-w-xs mx-auto break-all">
                  Connected to{" "}
                  <span className="font-mono">{SIGNALING_URL}</span>
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

      {controlActive && (
        <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/30 text-amber-200 text-xs text-center">
          Remote control active — your clicks and keys go into the presenter's tab.
          Only works if the presenter has enabled control.
        </div>
      )}
    </div>
  );
}

function ControlOverlay({
  videoRef,
  sendControl,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sendControl: (event: ControlEvent) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastMoveRef = useRef(0);

  const toVideoCoords = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || !video.videoWidth) return null;
    const rect = overlay.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    return {
      x: Math.round(localX * scaleX),
      y: Math.round(localY * scaleY),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const c = toVideoCoords(e.clientX, e.clientY);
    if (!c) return;
    sendControl({
      kind: "mouse",
      x: c.x,
      y: c.y,
      button: mapButton(e.button),
      action: "down",
      clickCount: e.detail || 1,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const c = toVideoCoords(e.clientX, e.clientY);
    if (!c) return;
    sendControl({
      kind: "mouse",
      x: c.x,
      y: c.y,
      button: mapButton(e.button),
      action: "up",
      clickCount: e.detail || 1,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastMoveRef.current < MOUSE_MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;
    const c = toVideoCoords(e.clientX, e.clientY);
    if (!c) return;
    sendControl({ kind: "mouse", x: c.x, y: c.y, action: "move" });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const c = toVideoCoords(e.clientX, e.clientY);
    if (!c) return;
    sendControl({
      kind: "scroll",
      x: c.x,
      y: c.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div
      ref={overlayRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      className="absolute inset-0 cursor-crosshair ring-2 ring-amber-400/70 rounded-lg"
      style={{ touchAction: "none" }}
      tabIndex={0}
    />
  );
}

function mapButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function computeModifiers(e: KeyboardEvent): number {
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
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
