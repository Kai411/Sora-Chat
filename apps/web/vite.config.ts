import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS=1 npm run dev — needed to test the mic (random call) from a phone on
// the LAN, since getUserMedia requires a secure context off-localhost.
export default defineConfig({
  plugins: [vue(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: {
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
