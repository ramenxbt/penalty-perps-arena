import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function vendorChunk(id: string): string | undefined {
  if (!id.includes("/node_modules/")) return undefined;
  if (id.includes("/node_modules/react") || id.includes("/node_modules/react-dom")) return "vendor-react";
  if (id.includes("/node_modules/three/")) return "vendor-three";
  if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
});
