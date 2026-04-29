import type { SignalingMessage } from "@oneclickcast/shared";

export interface Env {
  ROOMS: DurableObjectNamespace;
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

type ClientRole = "presenter" | "viewer";

interface Client {
  socket: WebSocket;
  id: string;
  role: ClientRole;
  joinedAt: number;
}

export class Room {
  private state: DurableObjectState;
  private clients = new Map<string, Client>();
  private presenterId: string | null = null;

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

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSession(socket: WebSocket, id: string, role: ClientRole) {
    if (role === "presenter") {
      if (this.presenterId) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Presenter already in this room",
          }),
        );
        socket.close(1008, "Presenter already in this room");
        return;
      }
      this.presenterId = id;
    }

    const client: Client = { socket, id, role, joinedAt: Date.now() };
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
      try {
        const msg = JSON.parse(event.data as string) as SignalingMessage;
        this.routeMessage(client, msg);
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Invalid message",
          }),
        );
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
    }
  }

  private handleDisconnect(client: Client) {
    this.clients.delete(client.id);

    if (client.role === "presenter") {
      this.presenterId = null;
      this.broadcast({ type: "presenter-left" });
      for (const c of this.clients.values()) c.socket.close(1000, "Presenter left");
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
    if (c) c.socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) c.socket.send(data);
  }

  private viewerCount(): number {
    let count = 0;
    for (const c of this.clients.values()) if (c.role === "viewer") count++;
    return count;
  }
}
