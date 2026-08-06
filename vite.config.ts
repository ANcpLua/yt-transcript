import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig(({mode}) => {
  const firefox = mode === "firefox";
  return {
    plugins: [react(), tailwindcss()],
    root: "src/sidepanel",
    base: "./",
    define: {
      __FIREFOX__: JSON.stringify(firefox),
    },
    build: {
      outDir: firefox
        ? resolve(__dirname, "packages/extension/dist-firefox/sidepanel")
        : resolve(__dirname, "dist/sidepanel"),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});
