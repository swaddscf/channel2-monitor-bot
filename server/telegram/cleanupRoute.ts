import type { Express, Request, Response } from "express";
import { cleanupBotData } from "./botDb";
import { sdk } from "../_core/sdk";

export function registerTelegramCleanupRoute(app: Express) {
  app.post("/api/scheduled/telegram-cleanup", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await cleanupBotData();
      return res.json({ ok: true, ...result, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Telegram cleanup] Failed", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
}
