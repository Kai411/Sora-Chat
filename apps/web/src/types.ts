export interface PublicUser {
  nickname: string;
  avatar: string;
  vip: boolean;
  bot?: boolean;
}

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface GachaItem {
  name: string;
  icon: string;
  rarity: Rarity;
}

export interface Post {
  id: number;
  author: string;
  avatar: string;
  text: string;
  ts: number;
  likes: number;
  liked: boolean;
  following: boolean;
  mine: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  icon: string;
  topic: string;
  members?: number;
}

export interface RoomMsg {
  id: number;
  author: string;
  avatar: string;
  text: string;
  ts: number;
}

export interface MatchFound {
  sessionId: string;
  mode: "chat" | "call";
  role: "caller" | "callee";
  peer: PublicUser;
}
