import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Deployed to GitHub Pages at https://<user>.github.io/ambria-prod/
// so assets must be served from the /ambria-prod/ sub-path.
export default defineConfig({
  base: "/ambria-prod/",
  plugins: [react(), tailwindcss()],
});
