import type { SignalingMessage } from "@oneclickcast/shared";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

interface OffscreenStartMessage {
  target: "offscreen";
  type: "START_CAPTURE";
  streamId: string;
  roomId: string;
  signalingUrl: string;
}

interface OffscreenStopMessage {
  target: "offscreen";
  type: "STOP_CAPTURE";
}

type OffscreenMessage = OffscreenStartMessage | OffscreenStopMessage;

let stream: MediaStream | null = null;
let ws: WebSocket | null = null;
let myClientId: string | null = null;
const peers = new Map<string, RTCPeerConnection>();

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as OffscreenMessage;
  if (msg?.target !== "offscreen") return;

  (async () => {
    try {
      if (msg.type === "START_CAPTURE") {
        await startCapture(msg.streamId, msg.roomId, msg.signalingUrl);
        sendResponse({ ok: true });
      } else if (msg.type === "STOP_CAPTURE") {
        stopCapture();
        sendResponse({ ok: true });
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
) {
  if (stream || ws) {
    stopCapture();
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
      },
    } as unknown as MediaTrackConstraints,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
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
      chrome.runtime.sendMessage({ type: "USER_STOPPED_SHARE" }).catch(() => {});
      stopCapture();
    });
  }

  ws = new WebSocket(`${signalingUrl}/room/${roomId}?role=presenter`);

  ws.addEventListener("open", () => {
    console.log("[offscreen] Signaling connected");
  });

  ws.addEventListener("message", async (event) => {
    let msg: SignalingMessage & { fromId?: string };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (msg.type) {
      case "joined":
        myClientId = msg.clientId;
        break;

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

      case "error":
        console.error("[offscreen] Signaling error:", msg.error);
        break;
    }
  });

  ws.addEventListener("close", () => {
    console.log("[offscreen] Signaling closed");
  });

  ws.addEventListener("error", (e) => {
    console.error("[offscreen] Signaling error", e);
  });
}

async function handleViewerJoined(viewerId: string) {
  if (!stream) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(viewerId, pc);

  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
          targetId: viewerId,
        }),
      );
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[offscreen] viewer ${viewerId} state: ${pc.connectionState}`);
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      peers.delete(viewerId);
      pc.close();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws?.send(
    JSON.stringify({
      type: "offer",
      sdp: offer.sdp,
      targetId: viewerId,
    }),
  );
}

async function handleAnswer(viewerId: string, sdp: string) {
  const pc = peers.get(viewerId);
  if (!pc) return;
  await pc.setRemoteDescription({ type: "answer", sdp });
}

async function handleViewerIce(
  viewerId: string,
  candidate: RTCIceCandidateInit,
) {
  const pc = peers.get(viewerId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn("[offscreen] Failed to add ICE candidate", err);
  }
}

function handleViewerLeft(viewerId: string) {
  const pc = peers.get(viewerId);
  if (pc) {
    pc.close();
    peers.delete(viewerId);
  }
}

function notifyViewerCount(count: number) {
  chrome.runtime
    .sendMessage({ type: "VIEWER_COUNT_UPDATE", count })
    .catch(() => {});
}

function stopCapture() {
  for (const pc of peers.values()) pc.close();
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

  myClientId = null;
}

export {};
