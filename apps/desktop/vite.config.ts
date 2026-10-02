import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  clearScreen: false,
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
