import type { SignalingMessage, IceServer } from "@oneclickcast/shared";

export interface Env {
  ROOMS: DurableObjectNamespace;
  TURN_HOST?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Upgrade",
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
      {
        urls: `turn:${host}:80?transport=udp`,
        username,
        credential,
      },
      {
        urls: `turn:${host}:80?transport=tcp`,
        username,
        credential,
      },
      {
        urls: `turns:${host}:443?transport=tcp`,
        username,
        credential,
      },
    );
  }

  return servers;
}

type ClientRole = "presenter" | "viewer";

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
  private clients = new Map<string, Client>();
  private presenterId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role = (url.searchParams.get("role") as ClientRole) ?? "viewer";
    const clientId = crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();
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

    if (role === "viewer" && this.presenterId) {
      this.sendTo(this.presenterId, {
        type: "viewer-joined",
        viewerId: id,
        viewerCount: this.viewerCount(),
      });
    }

    socket.addEventListener("message", (event) => {
      client.lastSeenAt = Date.now();
      try {
        const msg = JSON.parse(event.data as string) as SignalingMessage;
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

  private routeMessage(from: Client, msg: SignalingMessage) {
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
          this.sendTo(this.presenterId, { ...msg, fromId: from.id });
        }
        break;

      case "ping":
        from.socket.send(JSON.stringify({ type: "pong" }));
        break;

      case "pong":
        // lastSeenAt already updated above
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
    } else if (this.presenterId) {
      this.sendTo(this.presenterId, {
        type: "viewer-left",
        viewerId: client.id,
        viewerCount: this.viewerCount(),
      });
    }
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
