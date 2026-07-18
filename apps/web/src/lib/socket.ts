import { io, type Socket } from "socket.io-client";

// Same-origin in dev (vite proxies /socket.io to the server) and in prod
// builds served by/behind the API. Capacitor builds will override via
// VITE_SERVER_URL since the webview origin is capacitor://localhost.
const url = import.meta.env.VITE_SERVER_URL ?? "/";

export const socket: Socket = io(url, { autoConnect: false });

/** Origin for server-hosted assets (e.g. /uploads images); "" = same origin. */
export const serverBase: string = import.meta.env.VITE_SERVER_URL ?? "";

/**
 * Resolve an image path. `/uploads/*` (feed photos, banners, admin-uploaded
 * shop images) live on the Socket.IO server; everything else (preset art in
 * public/) is served by the web host at the same origin.
 */
export function assetUrl(src: string | null | undefined): string {
  if (!src) return "";
  return src.startsWith("/uploads/") ? serverBase + src : src;
}
