import type { Express } from "express";
import { storageGetSignedUrl } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    try {
      res.redirect(307, await storageGetSignedUrl(key));
    } catch (error) {
      console.error("[Storage] Signed URL failed:", error);
      res.status(404).send("Document not found");
    }
  });
}
