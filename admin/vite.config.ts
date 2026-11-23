import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev port 3101 (= ADMIN_URL in backend/.env.example).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 3101, strictPort: true },
  preview: { port: 3101, strictPort: true },
});
