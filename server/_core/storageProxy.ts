import type { Express } from "express";
import { ENV } from "./env";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    const publicUrl = `${ENV.supabaseUrl}/storage/v1/object/public/veritylens/${key}`;
    res.redirect(307, publicUrl);
  });
}
