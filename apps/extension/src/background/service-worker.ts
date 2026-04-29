import {
  generateRoomId,
  type ViewerStats,
  type ViewerEngagement,
  type ControlEvent,
} from "@oneclickcast/shared";

const WEB_BASE_URL =
  import.meta.env.VITE_WEB_BASE_URL ??
  "https://oneclickcast.info-codeandpromote.workers.dev";
const VIEWER_BASE_URL =
  import.meta.env.VITE_VIEWER_BASE_URL ?? `${WEB_BASE_URL}/room`;
const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ??
  "wss://oneclickcast-signaling.info-codeandpromote.workers.dev";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";
const DEBUGGER_PROTOCOL_VERSION = "1.3";

type AuthUser = {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
};

type AuthState = {
  apiKey: string;
  user: AuthUser;
} | null;

let auth: AuthState = null;

async function loadAuth() {
  const stored = await chrome.storage.local.get("auth");
  auth = (stored.auth as AuthState) ?? null;
}

async function saveAuth(next: AuthState) {
  auth = next;
  if (next) {
    await chrome.storage.local.set({ auth: next });
  } else {
    await chrome.storage.local.remove("auth");
  }
}

void loadAuth();

type ShareMode = "any" | "tab";

type SessionState = {
  active: boolean;
  mode?: ShareMode;
  roomId?: string;
  shareLink?: string;
  viewerCount: number;
  startedAt?: number;
  viewerStats: ViewerStats[];
  engagement: ViewerEngagement[];
  micEnabled: boolean;
  projectorMode: boolean;
  recording: boolean;
  recordingStartedAt?: number;
  recordingElapsedMs: number;
  lastRecording?: {
    filename: string;
    sizeBytes: number;
    durationMs: number;
    finishedAt: number;
  };
  controlSupported: boolean;
  controlEnabled: boolean;
  sharedTabId?: number;
  sharedTabTitle?: string;
};

const initialSession = (): SessionState => ({
  active: false,
  viewerCount: 0,
  viewerStats: [],
  engagement: [],
  micEnabled: false,
  projectorMode: false,
  recording: false,
  recordingElapsedMs: 0,
  controlSupported: false,
  controlEnabled: false,
});

let session: SessionState = initialSession();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === "offscreen") return;

  (async () => {
    switch (msg.type) {
      case "GET_SESSION_STATE":
        sendResponse(session);
        return;

      case "GET_AUTH":
        sendResponse({ auth });
        return;

      case "OPEN_SIGN_IN":
        await chrome.tabs.create({
          url: `${WEB_BASE_URL}/dashboard/extension-link`,
        });
        sendResponse({ ok: true });
        return;

      case "CONNECT_KEY": {
        const key = (msg.key as string | undefined)?.trim();
        if (!key) {
          sendResponse({ ok: false, error: "Empty key" });
          return;
        }
        try {
          const httpUrl = SIGNALING_URL.replace(/^ws/, "http").replace(/\/+$/, "");
          const res = await fetch(
            `${httpUrl}/whoami?key=${encodeURIComponent(key)}`,
          );
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
          const data = (await res.json()) as { user: AuthUser };
          await saveAuth({ apiKey: key, user: data.user });
          sendResponse({ ok: true, user: data.user });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : "Failed to connect",
          });
        }
        return;
      }

      case "SIGN_OUT":
        await saveAuth(null);
        sendResponse({ ok: true });
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

      case "START_TAB_SHARE": {
        try {
          const result = await startTabShare(msg.streamId, msg.tabId, msg.tabTitle);
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

      case "TOGGLE_RECORDING": {
        try {
          const ack = (await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "TOGGLE_RECORDING",
          })) as
            | {
                ok: boolean;
                recording?: boolean;
                startedAt?: number;
                error?: string;
              }
            | undefined;
          if (ack?.ok) {
            session.recording = ack.recording === true;
            session.recordingStartedAt = ack.startedAt;
            if (!ack.recording) session.recordingElapsedMs = 0;
            await persistSession();
            sendResponse({ ok: true, recording: session.recording });
          } else {
            sendResponse({
              ok: false,
              error: ack?.error ?? "Recording toggle failed",
            });
          }
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : "Recording toggle failed",
          });
        }
        return;
      }

      case "RECORDING_TICK":
        if (session.recording) {
          session.recordingElapsedMs = msg.elapsedMs ?? 0;
        }
        sendResponse({ ok: true });
        return;

      case "RECORDING_STATE_UPDATE":
        session.recording = msg.recording === true;
        if (!msg.recording) {
          session.recordingStartedAt = undefined;
          session.recordingElapsedMs = 0;
          if (msg.finalized) {
            session.lastRecording = {
              filename: msg.finalized.filename,
              sizeBytes: msg.finalized.sizeBytes,
              durationMs: msg.finalized.durationMs,
              finishedAt: Date.now(),
            };
          }
        } else if (msg.startedAt) {
          session.recordingStartedAt = msg.startedAt;
        }
        await persistSession();
        sendResponse({ ok: true });
        return;

      case "TOGGLE_PROJECTOR_MODE": {
        try {
          const ack = (await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "TOGGLE_PROJECTOR_MODE",
          })) as
            | { ok: boolean; projectorMode?: boolean; error?: string }
            | undefined;
          if (ack?.ok) {
            session.projectorMode = ack.projectorMode === true;
            await persistSession();
            sendResponse({
              ok: true,
              projectorMode: session.projectorMode,
            });
          } else {
            sendResponse({
              ok: false,
              error: ack?.error ?? "Projector toggle failed",
            });
          }
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : "Projector toggle failed",
          });
        }
        return;
      }

      case "TOGGLE_REMOTE_CONTROL": {
        try {
          const result = await toggleRemoteControl();
          sendResponse(result);
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : "Toggle failed",
          });
        }
        return;
      }

      case "CONTROL_EVENT":
        await handleControlEvent(msg.event as ControlEvent);
        sendResponse({ ok: true });
        return;

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
    apiKey: auth?.apiKey,
    mode: "any",
  })) as { ok: boolean; error?: string } | undefined;

  if (!ack?.ok) {
    await closeOffscreen();
    return { error: ack?.error ?? "Failed to start capture" };
  }

  session = {
    ...initialSession(),
    active: true,
    mode: "any",
    roomId,
    shareLink,
    startedAt: Date.now(),
    controlSupported: false,
  };
  await persistSession();

  return { shareLink, roomId };
}

async function startTabShare(
  streamId: string,
  tabId: number,
  tabTitle?: string,
): Promise<{ shareLink: string; roomId: string } | { error: string }> {
  if (!streamId || typeof tabId !== "number") {
    return { error: "Invalid tab share params" };
  }

  const roomId = generateRoomId();
  const shareLink = `${VIEWER_BASE_URL}/${roomId}`;

  await ensureOffscreen();

  const ack = (await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId,
    roomId,
    signalingUrl: SIGNALING_URL,
    apiKey: auth?.apiKey,
    mode: "tab",
    tabTitle,
  })) as { ok: boolean; error?: string } | undefined;

  if (!ack?.ok) {
    await closeOffscreen();
    return { error: ack?.error ?? "Failed to start capture" };
  }

  session = {
    ...initialSession(),
    active: true,
    mode: "tab",
    roomId,
    shareLink,
    startedAt: Date.now(),
    controlSupported: true,
    sharedTabId: tabId,
    sharedTabTitle: tabTitle,
  };
  await persistSession();

  return { shareLink, roomId };
}

async function stopShare() {
  await detachDebugger();

  try {
    await chrome.runtime
      .sendMessage({ target: "offscreen", type: "STOP_CAPTURE" })
      .catch(() => {});
  } catch {}
  await closeOffscreen();

  session = initialSession();
  await persistSession();
}

async function toggleRemoteControl(): Promise<{
  ok: boolean;
  controlEnabled?: boolean;
  error?: string;
}> {
  if (!session.active || !session.controlSupported || !session.sharedTabId) {
    return {
      ok: false,
      error: "Remote control only works with the 'Share tab' mode",
    };
  }

  if (session.controlEnabled) {
    await detachDebugger();
    session.controlEnabled = false;
    await persistSession();
    return { ok: true, controlEnabled: false };
  }

  try {
    await attachDebugger(session.sharedTabId);
    session.controlEnabled = true;
    await persistSession();
    return { ok: true, controlEnabled: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to attach debugger",
    };
  }
}

function attachDebugger(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function detachDebugger() {
  if (!session.sharedTabId || !session.controlEnabled) return;
  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId: session.sharedTabId! }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function handleControlEvent(event: ControlEvent) {
  if (!session.controlEnabled || !session.sharedTabId) return;
  const tabId = session.sharedTabId;

  try {
    if (event.kind === "mouse") {
      const button = event.button ?? "left";
      const action = event.action;
      if (action === "click") {
        await sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: event.x,
          y: event.y,
          button,
          clickCount: 1,
        });
        await sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: event.x,
          y: event.y,
          button,
          clickCount: 1,
        });
      } else if (action === "doubleclick") {
        for (let i = 1; i <= 2; i++) {
          await sendCdp(tabId, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: event.x,
            y: event.y,
            button,
            clickCount: i,
          });
          await sendCdp(tabId, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: event.x,
            y: event.y,
            button,
            clickCount: i,
          });
        }
      } else {
        const cdpType =
          action === "down"
            ? "mousePressed"
            : action === "up"
              ? "mouseReleased"
              : "mouseMoved";
        await sendCdp(tabId, "Input.dispatchMouseEvent", {
          type: cdpType,
          x: event.x,
          y: event.y,
          button: action === "move" ? "none" : button,
          clickCount: event.clickCount ?? (action === "move" ? 0 : 1),
        });
      }
    } else if (event.kind === "key") {
      const cdpType =
        event.action === "down"
          ? "keyDown"
          : event.action === "up"
            ? "keyUp"
            : "char";
      await sendCdp(tabId, "Input.dispatchKeyEvent", {
        type: cdpType,
        key: event.key,
        code: event.code,
        text: event.text,
        modifiers: event.modifiers ?? 0,
      });
    } else if (event.kind === "scroll") {
      await sendCdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.x,
        y: event.y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    }
  } catch (err) {
    console.warn("[OneClickCast] Control dispatch failed", err);
  }
}

function sendCdp(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
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

chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (
    session.controlEnabled &&
    typeof source.tabId === "number" &&
    source.tabId === session.sharedTabId
  ) {
    console.log("[OneClickCast] debugger detached:", reason);
    session.controlEnabled = false;
    await persistSession();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (session.active && session.sharedTabId === tabId) {
    console.log("[OneClickCast] shared tab closed; ending session");
    await stopShare();
  }
});

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
