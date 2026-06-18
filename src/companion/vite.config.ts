import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3001,
    strictPort: true,
  },
  define: {
    "import.meta.env.VITE_ORCH_WS": JSON.stringify(
      process.env.VITE_ORCH_WS ?? "ws://127.0.0.1:8765/ws"
    ),
  },
});
