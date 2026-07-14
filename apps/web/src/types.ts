export interface PublicUser {
  id: number;
  nickname: string;
  avatar: string;
  vip: boolean;
}

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface GachaItem {
  name: string;
  icon: string;
  rarity: Rarity;
}

export interface Post {
  id: number;
  userId: number;
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
  creator?: PublicUser;
  members?: number;
}

export interface RoomMsg {
  id: number;
  userId: number;
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

export interface DmMessage {
  id: number;
  text: string;
  ts: number;
  mine: boolean;
}

export interface Conversation {
  user: PublicUser;
  last: { text: string; ts: number; mine: boolean };
  unread: number;
}
