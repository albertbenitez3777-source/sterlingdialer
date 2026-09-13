// vite.config.ts
import { defineConfig, loadEnv } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///home/project/vite.config.ts";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || "";
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
      }
    },
    optimizeDeps: {
      exclude: ["lucide-react"]
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/functions": {
          target: supabaseUrl,
          changeOrigin: true,
          secure: true
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCc7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XG4gIGNvbnN0IGVudiA9IGxvYWRFbnYobW9kZSwgcHJvY2Vzcy5jd2QoKSwgJycpO1xuICBjb25zdCBzdXBhYmFzZVVybCA9IGVudi5WSVRFX1NVUEFCQVNFX1VSTCB8fCAnJztcblxuICByZXR1cm4ge1xuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgICByZXNvbHZlOiB7XG4gICAgICBhbGlhczoge1xuICAgICAgICAnQCc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9zcmMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBvcHRpbWl6ZURlcHM6IHtcbiAgICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgfSxcbiAgICBzZXJ2ZXI6IHtcbiAgICAgIGhvc3Q6IFwiMC4wLjAuMFwiLFxuICAgICAgYWxsb3dlZEhvc3RzOiB0cnVlLFxuICAgICAgcHJveHk6IHtcbiAgICAgICAgJy9mdW5jdGlvbnMnOiB7XG4gICAgICAgICAgdGFyZ2V0OiBzdXBhYmFzZVVybCxcbiAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICAgICAgc2VjdXJlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlOLFNBQVMsY0FBYyxlQUFlO0FBQy9QLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWUsV0FBVztBQUYrRixJQUFNLDJDQUEyQztBQUtuTCxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN4QyxRQUFNLE1BQU0sUUFBUSxNQUFNLFFBQVEsSUFBSSxHQUFHLEVBQUU7QUFDM0MsUUFBTSxjQUFjLElBQUkscUJBQXFCO0FBRTdDLFNBQU87QUFBQSxJQUNMLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxJQUNqQixTQUFTO0FBQUEsTUFDUCxPQUFPO0FBQUEsUUFDTCxLQUFLLGNBQWMsSUFBSSxJQUFJLFNBQVMsd0NBQWUsQ0FBQztBQUFBLE1BQ3REO0FBQUEsSUFDRjtBQUFBLElBQ0EsY0FBYztBQUFBLE1BQ1osU0FBUyxDQUFDLGNBQWM7QUFBQSxJQUMxQjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsT0FBTztBQUFBLFFBQ0wsY0FBYztBQUFBLFVBQ1osUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFFBQ1Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
