import type {
  IceServer,
  SignalingMessage,
  ViewerStats,
  PeerConnectionStateLike,
  ConnectionQuality,
  EngagementState,
  ViewerEngagement,
} from "@oneclickcast/shared";

const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const STATS_INTERVAL_MS = 3_000;
const PRESENTER_PING_INTERVAL_MS = 25_000;
const INATTENTION_THRESHOLD_MS = 10_000;

const NORMAL_MAX_BITRATE = 2_500_000;
const PROJECTOR_MAX_BITRATE = 8_000_000;
const NORMAL_MAX_FRAMERATE = 30;
const PROJECTOR_MAX_FRAMERATE = 60;

interface OffscreenStartMessage {
  target: "offscreen";
  type: "START_CAPTURE";
  streamId: string;
  roomId: string;
  signalingUrl: string;
  apiKey?: string;
  mode?: "any" | "tab";
  tabTitle?: string;
}

interface OffscreenStopMessage {
  target: "offscreen";
  type: "STOP_CAPTURE";
}

interface OffscreenToggleMicMessage {
  target: "offscreen";
  type: "TOGGLE_MIC";
}

interface OffscreenToggleProjectorMessage {
  target: "offscreen";
  type: "TOGGLE_PROJECTOR_MODE";
}

interface OffscreenToggleRecordingMessage {
  target: "offscreen";
  type: "TOGGLE_RECORDING";
}

type OffscreenMessage =
  | OffscreenStartMessage
  | OffscreenStopMessage
  | OffscreenToggleMicMessage
  | OffscreenToggleProjectorMessage
  | OffscreenToggleRecordingMessage;

interface PeerEntry {
  pc: RTCPeerConnection;
  lastBytesSent: number;
  lastReportAt: number;
  packetsLost: number;
  packetsSent: number;
}

let stream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let projectorMode = false;
let mediaRecorder: MediaRecorder | null = null;
let recordingChunks: Blob[] = [];
let recordingStartedAt = 0;
let recordingTickTimer: ReturnType<typeof setInterval> | null = null;
let ws: WebSocket | null = null;
let session: {
  roomId: string;
  signalingUrl: string;
  iceServers: IceServer[];
  apiKey?: string;
  mode: "any" | "tab";
  tabTitle?: string;
} | null = null;
let active = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
const peers = new Map<string, PeerEntry>();
const engagement = new Map<string, ViewerEngagement>();
const inattentionTimers = new Map<string, ReturnType<typeof setTimeout>>();

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as OffscreenMessage;
  if (msg?.target !== "offscreen") return;

  (async () => {
    try {
      if (msg.type === "START_CAPTURE") {
        await startCapture(
          msg.streamId,
          msg.roomId,
          msg.signalingUrl,
          msg.apiKey,
          msg.mode ?? "any",
          msg.tabTitle,
        );
        sendResponse({ ok: true });
      } else if (msg.type === "STOP_CAPTURE") {
        await stopCapture();
        sendResponse({ ok: true });
      } else if (msg.type === "TOGGLE_MIC") {
        const enabled = await toggleMic();
        sendResponse({ ok: true, micEnabled: enabled });
      } else if (msg.type === "TOGGLE_PROJECTOR_MODE") {
        const enabled = await toggleProjectorMode();
        sendResponse({ ok: true, projectorMode: enabled });
      } else if (msg.type === "TOGGLE_RECORDING") {
        const result = await toggleRecording();
        sendResponse({ ok: true, ...result });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error("[offscreen]", error, err);
      sendResponse({ ok: false, error });
    }
  })();
  return true;
});

async function startCapture(
  streamId: string,
  roomId: string,
  signalingUrl: string,
  apiKey?: string,
  mode: "any" | "tab" = "any",
  tabTitle?: string,
) {
  if (active) stopCapture();

  // For streamIds from chrome.tabCapture.getMediaStreamId, the source must
  // be "tab". For chrome.desktopCapture.chooseDesktopMedia, it's "desktop"
  // even when the user picked a tab from that picker.
  const chromeMediaSource = mode === "tab" ? "tab" : "desktop";

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource,
        chromeMediaSourceId: streamId,
      },
    } as unknown as MediaTrackConstraints,
    video: {
      mandatory: {
        chromeMediaSource,
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    } as unknown as MediaTrackConstraints,
  });

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.addEventListener("ended", () => {
      console.log("[offscreen] User ended share via browser UI");
      chrome.runtime
        .sendMessage({ type: "USER_STOPPED_SHARE" })
        .catch(() => {});
      stopCapture();
    });
  }

  const iceServers = await fetchIceServers(signalingUrl);
  session = { roomId, signalingUrl, iceServers, apiKey, mode, tabTitle };
  active = true;

  connectSignaling();
  startStatsLoop();
}

async function fetchIceServers(signalingUrl: string): Promise<IceServer[]> {
  try {
    const httpUrl =
      signalingUrl.replace(/^ws/, "http").replace(/\/+$/, "") + "/ice-servers";
    const res = await fetch(httpUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { iceServers?: IceServer[] };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers;
    }
  } catch (err) {
    console.warn("[offscreen] ICE servers fetch failed, using fallback", err);
  }
  return FALLBACK_ICE_SERVERS;
}

function connectSignaling() {
  if (!session || !active) return;

  const params = new URLSearchParams();
  params.set("role", "presenter");
  params.set("mode", session.mode);
  if (session.apiKey) params.set("key", session.apiKey);
  if (session.tabTitle) params.set("tab", session.tabTitle);
  const url = `${session.signalingUrl}/room/${session.roomId}?${params.toString()}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("[offscreen] Signaling connected");
    reconnectAttempts = 0;
    startPingLoop();
  });

  ws.addEventListener("message", async (event) => {
    let msg: SignalingMessage & { fromId?: string };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    await handleSignalMessage(msg);
  });

  ws.addEventListener("close", () => {
    stopPingLoop();
    if (active) scheduleReconnect();
  });

  ws.addEventListener("error", (e) => {
    console.warn("[offscreen] Signaling error", e);
  });
}

function scheduleReconnect() {
  if (!active || reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_INITIAL_DELAY_MS * 2 ** reconnectAttempts,
    RECONNECT_MAX_DELAY_MS,
  );
  reconnectAttempts += 1;
  console.log(`[offscreen] Reconnecting in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSignaling();
  }, delay);
}

async function handleSignalMessage(
  msg: SignalingMessage & { fromId?: string },
) {
  switch (msg.type) {
    case "viewer-joined":
      await handleViewerJoined(msg.viewerId);
      notifyViewerCount(msg.viewerCount);
      break;

    case "viewer-left":
      handleViewerLeft(msg.viewerId);
      notifyViewerCount(msg.viewerCount);
      break;

    case "answer":
      if (msg.fromId) await handleAnswer(msg.fromId, msg.sdp);
      break;

    case "ice-candidate":
      if (msg.fromId) await handleViewerIce(msg.fromId, msg.candidate);
      break;

    case "engagement":
      if (msg.fromId) handleEngagement(msg.fromId, msg.state);
      break;

    case "control":
      chrome.runtime
        .sendMessage({ type: "CONTROL_EVENT", event: msg.event })
        .catch(() => {});
      break;

    case "ping":
      sendSignal({ type: "pong" });
      break;

    case "error":
      console.error("[offscreen] Signaling error:", msg.error);
      break;
  }
}

function handleEngagement(viewerId: string, state: EngagementState) {
  engagement.set(viewerId, { viewerId, state, changedAt: Date.now() });

  const existing = inattentionTimers.get(viewerId);
  if (existing) {
    clearTimeout(existing);
    inattentionTimers.delete(viewerId);
  }

  if (state === "tabbed-away" || state === "minimized") {
    const timer = setTimeout(() => {
      inattentionTimers.delete(viewerId);
      chrome.runtime
        .sendMessage({ type: "INATTENTION_ALERT", viewerId, state })
        .catch(() => {});
    }, INATTENTION_THRESHOLD_MS);
    inattentionTimers.set(viewerId, timer);
  } else if (state === "watching") {
    chrome.runtime
      .sendMessage({ type: "VIEWER_RETURNED", viewerId })
      .catch(() => {});
  }

  notifyEngagement();
}

function notifyEngagement() {
  chrome.runtime
    .sendMessage({
      type: "VIEWER_ENGAGEMENT_UPDATE",
      engagement: Array.from(engagement.values()),
    })
    .catch(() => {});
}

async function handleViewerJoined(viewerId: string) {
  if (!stream || !session) return;

  const pc = new RTCPeerConnection({ iceServers: session.iceServers });
  peers.set(viewerId, {
    pc,
    lastBytesSent: 0,
    lastReportAt: Date.now(),
    packetsLost: 0,
    packetsSent: 0,
  });

  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  if (micStream) {
    const micTrack = micStream.getAudioTracks()[0];
    if (micTrack) pc.addTrack(micTrack, stream);
  }

  if (projectorMode) {
    preferH264(pc);
    await applyEncoderParams(pc, true);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: "ice-candidate",
        candidate: event.candidate.toJSON(),
        targetId: viewerId,
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(
      `[offscreen] viewer ${viewerId} iceState: ${pc.iceConnectionState}`,
    );
    if (pc.iceConnectionState === "failed") {
      void restartIceFor(viewerId);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[offscreen] viewer ${viewerId} state: ${pc.connectionState}`);
    if (pc.connectionState === "closed") {
      peers.delete(viewerId);
    }
  };

  await sendOffer(viewerId, false);
}

async function sendOffer(viewerId: string, iceRestart: boolean) {
  const entry = peers.get(viewerId);
  if (!entry) return;
  const offer = await entry.pc.createOffer({ iceRestart });
  await entry.pc.setLocalDescription(offer);
  sendSignal({
    type: "offer",
    sdp: offer.sdp ?? "",
    targetId: viewerId,
  });
}

async function restartIceFor(viewerId: string) {
  const entry = peers.get(viewerId);
  if (!entry) return;
  console.log(`[offscreen] Restarting ICE for ${viewerId}`);
  try {
    await sendOffer(viewerId, true);
  } catch (err) {
    console.error("[offscreen] ICE restart failed", err);
  }
}

async function handleAnswer(viewerId: string, sdp: string) {
  const entry = peers.get(viewerId);
  if (!entry) return;
  try {
    await entry.pc.setRemoteDescription({ type: "answer", sdp });
  } catch (err) {
    console.error("[offscreen] Failed to apply answer", err);
  }
}

async function handleViewerIce(
  viewerId: string,
  candidate: RTCIceCandidateInit,
) {
  const entry = peers.get(viewerId);
  if (!entry) return;
  try {
    await entry.pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn("[offscreen] Failed to add ICE candidate", err);
  }
}

function handleViewerLeft(viewerId: string) {
  const entry = peers.get(viewerId);
  if (entry) {
    entry.pc.close();
    peers.delete(viewerId);
  }
  engagement.delete(viewerId);
  const t = inattentionTimers.get(viewerId);
  if (t) {
    clearTimeout(t);
    inattentionTimers.delete(viewerId);
  }
  notifyEngagement();
}

function sendSignal(payload: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function startPingLoop() {
  stopPingLoop();
  pingTimer = setInterval(() => sendSignal({ type: "ping" }), PRESENTER_PING_INTERVAL_MS);
}

function stopPingLoop() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startStatsLoop() {
  if (statsTimer) return;
  statsTimer = setInterval(collectAndReportStats, STATS_INTERVAL_MS);
}

function stopStatsLoop() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
}

async function collectAndReportStats() {
  if (peers.size === 0) return;
  const all: ViewerStats[] = [];

  for (const [viewerId, entry] of peers.entries()) {
    const stats = await entry.pc.getStats();
    let bytesSent = 0;
    let packetsSent = 0;
    let packetsLost = 0;
    let rttMs = 0;

    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "video") {
        bytesSent += report.bytesSent ?? 0;
        packetsSent += report.packetsSent ?? 0;
      }
      if (report.type === "remote-inbound-rtp" && report.kind === "video") {
        packetsLost += report.packetsLost ?? 0;
        if (typeof report.roundTripTime === "number") {
          rttMs = Math.round(report.roundTripTime * 1000);
        }
      }
    });

    const now = Date.now();
    const dtSec = Math.max((now - entry.lastReportAt) / 1000, 0.001);
    const bitrateKbps = Math.round(((bytesSent - entry.lastBytesSent) * 8) / 1000 / dtSec);
    const dPacketsSent = Math.max(packetsSent - entry.packetsSent, 0);
    const dPacketsLost = Math.max(packetsLost - entry.packetsLost, 0);
    const packetLossPct =
      dPacketsSent > 0 ? Math.min((dPacketsLost / dPacketsSent) * 100, 100) : 0;

    entry.lastBytesSent = bytesSent;
    entry.lastReportAt = now;
    entry.packetsSent = packetsSent;
    entry.packetsLost = packetsLost;

    all.push({
      viewerId,
      state: (entry.pc.connectionState as PeerConnectionStateLike) ?? "unknown",
      quality: deriveQuality(packetLossPct, rttMs, entry.pc.connectionState),
      bitrateKbps: Math.max(bitrateKbps, 0),
      packetLossPct: Math.round(packetLossPct * 10) / 10,
      rttMs,
      updatedAt: now,
    });
  }

  chrome.runtime
    .sendMessage({ type: "VIEWER_STATS_UPDATE", stats: all })
    .catch(() => {});
}

function deriveQuality(
  lossPct: number,
  rttMs: number,
  state: RTCPeerConnectionState,
): ConnectionQuality {
  if (state === "failed" || state === "closed") return "failed";
  if (state !== "connected") return "fair";
  if (lossPct < 1 && rttMs < 150) return "good";
  if (lossPct < 5 && rttMs < 400) return "fair";
  return "poor";
}

function notifyViewerCount(count: number) {
  chrome.runtime
    .sendMessage({ type: "VIEWER_COUNT_UPDATE", count })
    .catch(() => {});
}

async function toggleRecording(): Promise<{
  recording: boolean;
  startedAt?: number;
}> {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    await stopRecording();
    return { recording: false };
  }
  const ok = startRecording();
  if (ok) {
    sendSignal({ type: "presenter-feature", feature: "recording", on: true });
  }
  return { recording: ok, startedAt: ok ? recordingStartedAt : undefined };
}

function pickRecordingMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

function startRecording(): boolean {
  if (!stream) return false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") return true;

  const tracks: MediaStreamTrack[] = [];
  for (const t of stream.getVideoTracks()) tracks.push(t);
  for (const t of stream.getAudioTracks()) tracks.push(t);
  if (micStream) for (const t of micStream.getAudioTracks()) tracks.push(t);
  const combined = new MediaStream(tracks);

  recordingChunks = [];
  recordingStartedAt = Date.now();

  const mimeType = pickRecordingMimeType();
  try {
    mediaRecorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
  } catch (err) {
    console.error("[offscreen] MediaRecorder construction failed", err);
    mediaRecorder = null;
    return false;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    finalizeRecording(mimeType);
  };

  mediaRecorder.onerror = (event) => {
    console.error("[offscreen] MediaRecorder error", event);
  };

  mediaRecorder.start(1000);
  startRecordingTicker();
  notifyRecordingState(true);
  return true;
}

function stopRecording(): Promise<void> {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      resolve();
      return;
    }
    const recorder = mediaRecorder;
    const originalOnStop = recorder.onstop;
    recorder.onstop = (event) => {
      try {
        if (typeof originalOnStop === "function") {
          originalOnStop.call(recorder, event);
        }
      } finally {
        resolve();
      }
    };
    recorder.stop();
    stopRecordingTicker();
  });
}

function finalizeRecording(mimeType: string) {
  if (recordingChunks.length === 0) {
    mediaRecorder = null;
    notifyRecordingState(false);
    return;
  }

  const blob = new Blob(recordingChunks, { type: mimeType });
  const sizeBytes = blob.size;
  const durationMs = Date.now() - recordingStartedAt;
  const url = URL.createObjectURL(blob);
  const filename = `oneclickcast-${formatStamp(new Date())}.webm`;

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  recordingChunks = [];
  mediaRecorder = null;
  notifyRecordingState(false, { filename, sizeBytes, durationMs });
}

function startRecordingTicker() {
  stopRecordingTicker();
  recordingTickTimer = setInterval(() => {
    chrome.runtime
      .sendMessage({
        type: "RECORDING_TICK",
        elapsedMs: Date.now() - recordingStartedAt,
      })
      .catch(() => {});
  }, 1000);
}

function stopRecordingTicker() {
  if (recordingTickTimer) {
    clearInterval(recordingTickTimer);
    recordingTickTimer = null;
  }
}

function notifyRecordingState(
  recording: boolean,
  finalized?: {
    filename: string;
    sizeBytes: number;
    durationMs: number;
  },
) {
  chrome.runtime
    .sendMessage({
      type: "RECORDING_STATE_UPDATE",
      recording,
      startedAt: recording ? recordingStartedAt : undefined,
      finalized,
    })
    .catch(() => {});
}

function formatStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function toggleProjectorMode(): Promise<boolean> {
  if (!stream) return projectorMode;
  projectorMode = !projectorMode;

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = projectorMode ? "motion" : "detail";
  }

  for (const [viewerId, entry] of peers.entries()) {
    if (projectorMode) preferH264(entry.pc);
    await applyEncoderParams(entry.pc, projectorMode);
    await sendOffer(viewerId, false);
  }

  return projectorMode;
}

function preferH264(pc: RTCPeerConnection) {
  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps) return;
  const h264 = caps.codecs.filter(
    (c) => c.mimeType.toLowerCase() === "video/h264",
  );
  if (h264.length === 0) return;
  const others = caps.codecs.filter(
    (c) => c.mimeType.toLowerCase() !== "video/h264",
  );
  const reordered = [...h264, ...others];

  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind === "video") {
      try {
        t.setCodecPreferences(reordered);
      } catch (err) {
        console.warn("[offscreen] setCodecPreferences failed", err);
      }
    }
  }
}

async function applyEncoderParams(pc: RTCPeerConnection, projector: boolean) {
  const sender = pc.getSenders().find((s) => s.track?.kind === "video");
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0]!.maxBitrate = projector
    ? PROJECTOR_MAX_BITRATE
    : NORMAL_MAX_BITRATE;
  params.encodings[0]!.maxFramerate = projector
    ? PROJECTOR_MAX_FRAMERATE
    : NORMAL_MAX_FRAMERATE;
  try {
    await sender.setParameters(params);
  } catch (err) {
    console.warn("[offscreen] setParameters failed", err);
  }
}

async function toggleMic(): Promise<boolean> {
  if (!stream) return false;
  if (micStream) {
    await disableMic();
    return false;
  }
  await enableMic();
  return true;
}

async function enableMic() {
  if (micStream || !stream) return;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  const micTrack = micStream.getAudioTracks()[0];
  if (!micTrack) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    return;
  }

  for (const [viewerId, entry] of peers.entries()) {
    entry.pc.addTrack(micTrack, stream);
    await sendOffer(viewerId, false);
  }
}

async function disableMic() {
  if (!micStream) return;
  const micTrack = micStream.getAudioTracks()[0];

  for (const [viewerId, entry] of peers.entries()) {
    if (micTrack) {
      const sender = entry.pc.getSenders().find((s) => s.track === micTrack);
      if (sender) entry.pc.removeTrack(sender);
    }
    await sendOffer(viewerId, false);
  }

  for (const t of micStream.getTracks()) t.stop();
  micStream = null;
}

async function stopCapture() {
  active = false;

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    await stopRecording();
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopStatsLoop();
  stopPingLoop();

  for (const t of inattentionTimers.values()) clearTimeout(t);
  inattentionTimers.clear();
  engagement.clear();

  for (const entry of peers.values()) entry.pc.close();
  peers.clear();

  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }

  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }

  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
    micStream = null;
  }

  projectorMode = false;
  recordingChunks = [];
  recordingStartedAt = 0;
  session = null;
  reconnectAttempts = 0;
}

export {};
