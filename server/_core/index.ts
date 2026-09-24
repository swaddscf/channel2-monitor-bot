import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serveStatic";
import { registerTelegramRoutes } from "../telegram/routes";
import { registerTelegramCleanupRoute } from "../telegram/cleanupRoute";
import { cleanupStaleJobs } from "../telegram/botDb";
import { initializeSupabaseStorage } from "../telegram/supabase";
import { isPollingEnabled, startTelegramPolling } from "../telegram/polling";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function configureTrustProxy(app: express.Express) {
  const raw = (process.env.TRUST_PROXY || "0").trim();
  if (raw === "1" || raw.toLowerCase() === "true") {
    app.set("trust proxy", 1);
  } else if (/^\d+$/.test(raw) && Number(raw) > 1) {
    app.set("trust proxy", Number(raw));
  }
}

function isProductionRuntime() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development") return false;
  return /[\\/]dist[\\/]/.test(new URL(import.meta.url).pathname);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  configureTrustProxy(app);
  // Drop any in-flight jobs left behind by a previous process.
  await cleanupStaleJobs();
  // Initialize shared Supabase/Postgres storage and cross-instance dedup when configured.
  await initializeSupabaseStorage().catch(error => console.error("[Supabase] init failed", error));
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerTelegramRoutes(app);
  registerTelegramCleanupRoute(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // production uses static files; anything else uses the Vite dev server
  if (isProductionRuntime()) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  // Managed hosts (Render, Docker, etc.) require binding to the exact assigned
  // port; only scan for a free port during local development.
  const port = process.env.PORT ? preferredPort : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  if (isPollingEnabled()) {
    await startTelegramPolling();
  }
}

startServer().catch(console.error);
