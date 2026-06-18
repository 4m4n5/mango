import { defineConfig } from "vite";

export default defineConfig({
  base: "/overlay/",
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
