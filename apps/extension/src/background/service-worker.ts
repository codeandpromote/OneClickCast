import {
  generateRoomId,
  type ViewerStats,
  type ViewerEngagement,
} from "@oneclickcast/shared";

const VIEWER_BASE_URL =
  import.meta.env.VITE_VIEWER_BASE_URL ?? "https://oneclickcast.pages.dev/room";
const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ??
  "wss://oneclickcast-signaling.workers.dev";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

type SessionState = {
  active: boolean;
  roomId?: string;
  shareLink?: string;
  viewerCount: number;
  startedAt?: number;
  viewerStats: ViewerStats[];
  engagement: ViewerEngagement[];
  micEnabled: boolean;
};

const initialSession = (): SessionState => ({
  active: false,
  viewerCount: 0,
  viewerStats: [],
  engagement: [],
  micEnabled: false,
});

let session: SessionState = initialSession();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === "offscreen") return;

  (async () => {
    switch (msg.type) {
      case "GET_SESSION_STATE":
        sendResponse(session);
        return;

      case "START_SHARE": {
        try {
          const result = await startShare();
          sendResponse(result);
        } catch (e) {
          sendResponse({
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
        return;
      }

      case "STOP_SHARE":
        await stopShare();
        sendResponse({ ok: true });
        return;

      case "VIEWER_COUNT_UPDATE":
        session.viewerCount = msg.count ?? 0;
        if (session.viewerCount === 0) session.viewerStats = [];
        await persistSession();
        sendResponse({ ok: true });
        return;

      case "VIEWER_STATS_UPDATE":
        session.viewerStats = (msg.stats ?? []) as ViewerStats[];
        sendResponse({ ok: true });
        return;

      case "VIEWER_ENGAGEMENT_UPDATE":
        session.engagement = (msg.engagement ?? []) as ViewerEngagement[];
        sendResponse({ ok: true });
        return;

      case "INATTENTION_ALERT":
        await fireInattentionNotification(msg.viewerId);
        sendResponse({ ok: true });
        return;

      case "VIEWER_RETURNED":
        try {
          chrome.notifications.clear(`inattention-${msg.viewerId}`);
        } catch {}
        sendResponse({ ok: true });
        return;

      case "TOGGLE_MIC": {
        try {
          const ack = (await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "TOGGLE_MIC",
          })) as
            | { ok: boolean; micEnabled?: boolean; error?: string }
            | undefined;
          if (ack?.ok) {
            session.micEnabled = ack.micEnabled === true;
            await persistSession();
            sendResponse({ ok: true, micEnabled: session.micEnabled });
          } else {
            sendResponse({ ok: false, error: ack?.error ?? "Mic toggle failed" });
          }
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : "Mic toggle failed",
          });
        }
        return;
      }

      case "USER_STOPPED_SHARE":
        await stopShare();
        sendResponse({ ok: true });
        return;

      default:
        sendResponse({ error: `Unknown message type: ${msg.type}` });
    }
  })();
  return true;
});

async function startShare(): Promise<
  { shareLink: string; roomId: string } | { error: string }
> {
  const streamId = await chooseDesktopMedia();
  if (!streamId) return { error: "Capture cancelled" };

  const roomId = generateRoomId();
  const shareLink = `${VIEWER_BASE_URL}/${roomId}`;

  await ensureOffscreen();

  const ack = (await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId,
    roomId,
    signalingUrl: SIGNALING_URL,
  })) as { ok: boolean; error?: string } | undefined;

  if (!ack?.ok) {
    await closeOffscreen();
    return { error: ack?.error ?? "Failed to start capture" };
  }

  session = {
    ...initialSession(),
    active: true,
    roomId,
    shareLink,
    startedAt: Date.now(),
  };
  await persistSession();

  return { shareLink, roomId };
}

async function stopShare() {
  try {
    await chrome.runtime
      .sendMessage({ target: "offscreen", type: "STOP_CAPTURE" })
      .catch(() => {});
  } catch {}
  await closeOffscreen();

  session = initialSession();
  await persistSession();
}

async function fireInattentionNotification(viewerId: string) {
  if (typeof viewerId !== "string" || viewerId.length === 0) return;
  const id = `inattention-${viewerId}`;
  const shortId = viewerId.slice(0, 6);
  try {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "src/assets/icon-128.png",
      title: "Viewer not watching",
      message: `${shortId} has tabbed away from your share`,
      priority: 1,
    });
  } catch (err) {
    console.warn("[OneClickCast] notification failed", err);
  }
}

function chooseDesktopMedia(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen", "window", "tab", "audio"],
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          resolve(null);
        } else {
          resolve(streamId);
        }
      },
    );
  });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [
      "USER_MEDIA" as chrome.offscreen.Reason,
      "WEB_RTC" as chrome.offscreen.Reason,
    ],
    justification: "Capture screen and stream to viewers via WebRTC",
  });
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function persistSession() {
  await chrome.storage.local.set({ session });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[OneClickCast] Extension installed", {
    SIGNALING_URL,
    VIEWER_BASE_URL,
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get("session");
  if (stored.session?.active) {
    session = initialSession();
    await persistSession();
  }
});

export {};
