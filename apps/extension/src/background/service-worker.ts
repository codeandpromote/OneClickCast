import { generateRoomId } from "@oneclickcast/shared";

const VIEWER_BASE_URL = "https://oneclickcast.pages.dev/room";
const SIGNALING_URL = "wss://oneclickcast-signaling.workers.dev";

type SessionState = {
  active: boolean;
  roomId?: string;
  shareLink?: string;
  viewerCount: number;
  startedAt?: number;
};

let session: SessionState = { active: false, viewerCount: 0 };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "GET_SESSION_STATE":
        sendResponse(session);
        break;

      case "START_SHARE": {
        try {
          const roomId = generateRoomId();
          const shareLink = `${VIEWER_BASE_URL}/${roomId}`;
          session = {
            active: true,
            roomId,
            shareLink,
            viewerCount: 0,
            startedAt: Date.now(),
          };
          await chrome.storage.local.set({ session });
          sendResponse({ shareLink, roomId });
        } catch (e) {
          sendResponse({
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
        break;
      }

      case "STOP_SHARE":
        session = { active: false, viewerCount: 0 };
        await chrome.storage.local.set({ session });
        sendResponse({ ok: true });
        break;

      case "VIEWER_JOINED":
        session.viewerCount += 1;
        await chrome.storage.local.set({ session });
        sendResponse({ ok: true });
        break;

      case "VIEWER_LEFT":
        session.viewerCount = Math.max(0, session.viewerCount - 1);
        await chrome.storage.local.set({ session });
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: `Unknown message type: ${msg.type}` });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[OneClickCast] Extension installed", { SIGNALING_URL });
});

export {};
