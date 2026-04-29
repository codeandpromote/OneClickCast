import type { SignalingMessage, IceServer } from "@oneclickcast/shared";

export interface Env {
  ROOMS: DurableObjectNamespace;
  TURN_HOST?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Upgrade, Authorization",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true }, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/ice-servers") {
      return Response.json(
        { iceServers: buildIceServers(env) },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } },
      );
    }

    if (url.pathname === "/whoami") {
      return whoami(request, env);
    }

    const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{4,32})$/);
    if (match) {
      const roomId = match[1]!;
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};

async function whoami(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json(
      { error: "missing key param" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "supabase not configured" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
  const userId = await resolveExtensionKey(env, key);
  if (!userId) {
    return Response.json(
      { error: "invalid key" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  const profile = await fetchProfile(env, userId);
  return Response.json(
    { user: { id: userId, ...profile } },
    { headers: CORS_HEADERS },
  );
}

function buildIceServers(env: Env): IceServer[] {
  const servers: IceServer[] = [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ];

  const host = env.TURN_HOST;
  const username = env.TURN_USERNAME;
  const credential = env.TURN_CREDENTIAL;

  if (host && username && credential) {
    servers.push(
      { urls: `turn:${host}:80?transport=udp`, username, credential },
      { urls: `turn:${host}:80?transport=tcp`, username, credential },
      { urls: `turns:${host}:443?transport=tcp`, username, credential },
    );
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Supabase REST helpers (service-role)
// ---------------------------------------------------------------------------

async function supabaseFetch(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${env.SUPABASE_URL}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY!);
  headers.set("Authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

async function resolveExtensionKey(
  env: Env,
  key: string,
): Promise<string | null> {
  try {
    const res = await supabaseFetch(env, "/rest/v1/rpc/resolve_extension_api_key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as string | null;
    return data ?? null;
  } catch (err) {
    console.error("[signaling] resolveExtensionKey failed", err);
    return null;
  }
}

async function fetchProfile(
  env: Env,
  userId: string,
): Promise<{ email?: string; full_name?: string; avatar_url?: string }> {
  try {
    const res = await supabaseFetch(
      env,
      `/rest/v1/profiles?select=email,full_name,avatar_url&id=eq.${userId}&limit=1`,
    );
    if (!res.ok) return {};
    const rows = (await res.json()) as Array<{
      email?: string;
      full_name?: string;
      avatar_url?: string;
    }>;
    return rows[0] ?? {};
  } catch (err) {
    console.error("[signaling] fetchProfile failed", err);
    return {};
  }
}

interface SessionInsert {
  user_id: string | null;
  room_id: string;
  mode: "any" | "tab";
  shared_tab_title?: string | null;
}

async function createShareSession(
  env: Env,
  payload: SessionInsert,
): Promise<string | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await supabaseFetch(env, "/rest/v1/share_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[signaling] create session failed", res.status, await res.text());
      return null;
    }
    const rows = (await res.json()) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[signaling] createShareSession failed", err);
    return null;
  }
}

async function patchShareSession(
  env: Env,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const res = await supabaseFetch(
      env,
      `/rest/v1/share_sessions?id=eq.${sessionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      console.error("[signaling] patch session failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[signaling] patchShareSession failed", err);
  }
}

// ---------------------------------------------------------------------------
// Room Durable Object
// ---------------------------------------------------------------------------

type ClientRole = "presenter" | "viewer";
type ShareMode = "any" | "tab";

interface Client {
  socket: WebSocket;
  id: string;
  role: ClientRole;
  joinedAt: number;
  lastSeenAt: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;

export class Room {
  private state: DurableObjectState;
  private env: Env;
  private clients = new Map<string, Client>();
  private presenterId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Session metadata accumulated over the room's lifetime
  private shareSessionId: string | null = null;
  private shareSessionUserId: string | null = null;
  private shareSessionStartedAt: number | null = null;
  private peakViewerCount = 0;
  private totalViewerJoins = 0;
  private wasRecorded = false;
  private remoteControlUsed = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role = (url.searchParams.get("role") as ClientRole) ?? "viewer";
    const mode = (url.searchParams.get("mode") as ShareMode) ?? "any";
    const apiKey = url.searchParams.get("key");
    const tabTitle = url.searchParams.get("tab");

    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{4,32})$/);
    const roomId = roomMatch?.[1] ?? "";
    const clientId = crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();

    if (role === "presenter") {
      // Resolve the api key (if any) and create the share_sessions row.
      // Done before handleSession so the metadata is in place when viewers
      // start joining.
      const userId = apiKey
        ? await resolveExtensionKey(this.env, apiKey)
        : null;
      this.shareSessionUserId = userId;
      this.shareSessionStartedAt = Date.now();
      this.peakViewerCount = 0;
      this.totalViewerJoins = 0;
      this.wasRecorded = false;
      this.remoteControlUsed = false;

      this.shareSessionId = await createShareSession(this.env, {
        user_id: userId,
        room_id: roomId,
        mode,
        shared_tab_title: tabTitle ?? null,
      });
    }

    this.handleSession(server, clientId, role);
    this.ensureHeartbeat();

    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const c of [...this.clients.values()]) {
        if (now - c.lastSeenAt > STALE_THRESHOLD_MS) {
          try {
            c.socket.close(1001, "Stale connection");
          } catch {}
          this.handleDisconnect(c);
          continue;
        }
        try {
          c.socket.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }

      if (this.clients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleSession(socket: WebSocket, id: string, role: ClientRole) {
    if (role === "presenter" && this.presenterId) {
      const existing = this.clients.get(this.presenterId);
      if (existing) {
        try {
          existing.socket.close(1000, "Replaced by reconnecting presenter");
        } catch {}
        this.clients.delete(this.presenterId);
      }
      this.presenterId = null;
    }

    if (role === "presenter") {
      this.presenterId = id;
    }

    const client: Client = {
      socket,
      id,
      role,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.clients.set(id, client);

    socket.send(
      JSON.stringify({
        type: "joined",
        clientId: id,
        role,
        viewerCount: this.viewerCount(),
      }),
    );

    if (role === "viewer") {
      this.totalViewerJoins += 1;
      const count = this.viewerCount();
      if (count > this.peakViewerCount) this.peakViewerCount = count;

      if (this.presenterId) {
        this.sendTo(this.presenterId, {
          type: "viewer-joined",
          viewerId: id,
          viewerCount: count,
        });
      }
    }

    socket.addEventListener("message", (event) => {
      client.lastSeenAt = Date.now();
      try {
        const msg = JSON.parse(event.data as string) as
          | SignalingMessage
          | { type: "presenter-feature"; feature: "recording" | "control"; on: boolean };
        this.routeMessage(client, msg);
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid message" }));
      }
    });

    socket.addEventListener("close", () => {
      this.handleDisconnect(client);
    });

    socket.addEventListener("error", () => {
      this.handleDisconnect(client);
    });
  }

  private routeMessage(
    from: Client,
    msg:
      | SignalingMessage
      | { type: "presenter-feature"; feature: "recording" | "control"; on: boolean },
  ) {
    switch (msg.type) {
      case "offer":
      case "answer":
      case "ice-candidate":
        if (msg.targetId) {
          this.sendTo(msg.targetId, { ...msg, fromId: from.id });
        } else if (from.role === "viewer" && this.presenterId) {
          this.sendTo(this.presenterId, { ...msg, fromId: from.id });
        }
        break;

      case "engagement":
        if (this.presenterId && from.role === "viewer") {
          this.sendTo(this.presenterId, { ...msg, fromId: from.id });
        }
        break;

      case "control":
        if (this.presenterId && from.role === "viewer") {
          this.remoteControlUsed = true;
          this.sendTo(this.presenterId, { ...msg, fromId: from.id });
        }
        break;

      case "presenter-feature":
        if (from.role === "presenter") {
          if (msg.feature === "recording" && msg.on) this.wasRecorded = true;
          if (msg.feature === "control" && msg.on) this.remoteControlUsed = true;
        }
        break;

      case "ping":
        from.socket.send(JSON.stringify({ type: "pong" }));
        break;

      case "pong":
        break;
    }
  }

  private handleDisconnect(client: Client) {
    if (!this.clients.has(client.id)) return;
    this.clients.delete(client.id);

    if (client.role === "presenter" && this.presenterId === client.id) {
      this.presenterId = null;
      this.broadcast({ type: "presenter-left" });
      for (const c of this.clients.values()) {
        try {
          c.socket.close(1000, "Presenter left");
        } catch {}
      }
      this.clients.clear();

      this.finalizeShareSession();
    } else if (this.presenterId) {
      this.sendTo(this.presenterId, {
        type: "viewer-left",
        viewerId: client.id,
        viewerCount: this.viewerCount(),
      });
    }
  }

  private finalizeShareSession() {
    if (!this.shareSessionId || !this.shareSessionStartedAt) return;
    const id = this.shareSessionId;
    const endedAt = new Date().toISOString();
    const durationSec = Math.round(
      (Date.now() - this.shareSessionStartedAt) / 1000,
    );
    this.shareSessionId = null;
    this.shareSessionStartedAt = null;

    // Fire and forget
    void patchShareSession(this.env, id, {
      ended_at: endedAt,
      duration_sec: durationSec,
      peak_viewer_count: this.peakViewerCount,
      total_viewer_joins: this.totalViewerJoins,
      was_recorded: this.wasRecorded,
      remote_control_used: this.remoteControlUsed,
    });
  }

  private sendTo(id: string, msg: unknown) {
    const c = this.clients.get(id);
    if (c) {
      try {
        c.socket.send(JSON.stringify(msg));
      } catch {}
    }
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      try {
        c.socket.send(data);
      } catch {}
    }
  }

  private viewerCount(): number {
    let count = 0;
    for (const c of this.clients.values()) if (c.role === "viewer") count++;
    return count;
  }
}
