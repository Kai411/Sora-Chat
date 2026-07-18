export interface PublicUser {
  id: number;
  nickname: string;
  avatar: string;
  vip: boolean;
  frame?: string | null;
  pet?: string | null;
}

export type ShopType = "avatar" | "frame" | "background" | "bubble" | "pet";

export interface ShopCategory {
  type: ShopType;
  items: { src: string; price: number; name: string }[];
  owned: string[];
  equipped: string | null;
}

export interface AdminItem {
  id: number;
  type: ShopType;
  name: string;
  price: number;
  src: string;
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
  authorFrame?: string | null;
  text: string;
  image: string | null;
  ts: number;
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  mine: boolean;
}

export interface Comment {
  id: number;
  userId: number;
  author: string;
  avatar: string;
  frame?: string | null;
  text: string;
  ts: number;
}

export type RoomCategory = "music" | "private" | "chat";

export interface RoomInfo {
  id: string;
  name: string;
  icon: string;
  topic: string;
  category: RoomCategory;
  locked: boolean;
  creator?: PublicUser;
  members?: number;
}

export interface Seat extends PublicUser {
  muted: boolean;
  blocked: boolean;
}

export type SeatLayout = "grid" | "couple";

export interface RoomState {
  roomId: string;
  name?: string;
  hostId: number;
  admins: number[];
  layout: SeatLayout;
  locked: boolean;
  disabled: number[];
  background: string | null;
  seats: (Seat | null)[];
  requests: { user: PublicUser; seat: number }[];
}

export interface AvatarItem {
  id: string;
  src: string;
  price: number;
}

export interface Profile {
  user: PublicUser;
  background: string | null;
  banner: string | null;
  followers: number;
  following: number;
  posts: number;
  isFollowing: boolean;
  followsYou: boolean;
}

export interface GachaBanner {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  theme: string;
  mythic: { name: string; icon: string };
  pool: Record<Rarity, { rate: number; items: { name: string; icon: string }[] }>;
}

export interface RoomMsg {
  id: number;
  userId: number;
  author: string;
  avatar: string;
  frame?: string | null;
  text: string;
  ts: number;
  system?: boolean;
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
