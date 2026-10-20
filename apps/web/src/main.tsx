import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import { prepareTorrentStorage } from "./torrent/storage.js";

// Sweep torrent data left by a previous refresh/close before any new torrent starts.
void prepareTorrentStorage();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
