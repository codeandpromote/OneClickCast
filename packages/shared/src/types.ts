export type ClientRole = "presenter" | "viewer";

export interface IceCandidateInit {
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
  usernameFragment?: string | null;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface OfferMessage {
  type: "offer";
  sdp: string;
  targetId?: string;
  fromId?: string;
}

export interface AnswerMessage {
  type: "answer";
  sdp: string;
  targetId?: string;
  fromId?: string;
}

export interface IceCandidateMessage {
  type: "ice-candidate";
  candidate: IceCandidateInit;
  targetId?: string;
  fromId?: string;
}

export type EngagementState = "watching" | "tabbed-away" | "minimized";

export interface EngagementMessage {
  type: "engagement";
  state: EngagementState;
  fromId?: string;
}

export interface ViewerEngagement {
  viewerId: string;
  state: EngagementState;
  changedAt: number;
}

export interface ControlMessage {
  type: "control";
  event:
    | { kind: "mouse"; x: number; y: number; button?: number; action: "move" | "down" | "up" | "click" }
    | { kind: "key"; code: string; action: "down" | "up" }
    | { kind: "scroll"; deltaX: number; deltaY: number };
  fromId?: string;
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

export type ConnectionQuality = "good" | "fair" | "poor" | "failed";

export type PeerConnectionStateLike =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed"
  | "unknown";

export interface ViewerStats {
  viewerId: string;
  state: PeerConnectionStateLike;
  quality: ConnectionQuality;
  bitrateKbps: number;
  packetLossPct: number;
  rttMs: number;
  updatedAt: number;
}

export interface JoinedMessage {
  type: "joined";
  clientId: string;
  role: ClientRole;
  viewerCount: number;
}

export interface ViewerJoinedMessage {
  type: "viewer-joined";
  viewerId: string;
  viewerCount: number;
}

export interface ViewerLeftMessage {
  type: "viewer-left";
  viewerId: string;
  viewerCount: number;
}

export interface PresenterLeftMessage {
  type: "presenter-left";
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

export type SignalingMessage =
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | EngagementMessage
  | ControlMessage
  | PingMessage
  | PongMessage
  | JoinedMessage
  | ViewerJoinedMessage
  | ViewerLeftMessage
  | PresenterLeftMessage
  | ErrorMessage;

export interface RoomConfig {
  iceServers: IceServer[];
  maxBitrateKbps: number;
  preferredCodec: "VP8" | "VP9" | "H264" | "AV1";
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
  maxBitrateKbps: 2500,
  preferredCodec: "VP8",
};
