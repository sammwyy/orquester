import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "import.meta.env.VITE_ORQUESTER_CLIENT_VERSION": JSON.stringify(process.env.npm_package_version ?? "0.0.0")
  },
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        svgProps: { width: "1em", height: "1em" }
      }
    })
  ]
});
