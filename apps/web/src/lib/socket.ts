import { io, type Socket } from "socket.io-client";

// Same-origin in dev (vite proxies /socket.io to the server) and in prod
// builds served by/behind the API. Capacitor builds will override via
// VITE_SERVER_URL since the webview origin is capacitor://localhost.
const url = import.meta.env.VITE_SERVER_URL ?? "/";

export const socket: Socket = io(url, { autoConnect: false });
