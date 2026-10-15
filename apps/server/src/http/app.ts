import express, { type Express } from "express";

export function createHttpApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}
