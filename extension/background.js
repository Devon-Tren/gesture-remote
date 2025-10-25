// MV3 service worker (module)
// background.js
import { io } from "./vendor/socket.io.esm.min.js";


const DEFAULT_URL = "http://localhost:3000";   // your Next dev server
const SOCKET_PATH = "/api/socket_io";

let socket = null;
let currentUrl = null;

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_URL });
  return serverUrl || DEFAULT_URL;
}

async function warmAndConnect() {
  const url = await getServerUrl();
  if (socket && currentUrl === url && socket.connected) return;

  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
  currentUrl = url;

  // Warm your Next.js API so the Socket.IO server is created (singleton)
  try { await fetch(new URL("/api/socket", url).toString(), { cache: "no-store" }); } catch {}

  socket = io(url, {
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    reconnection: true
  });

  socket.on("connect", () => console.log("[ext] socket connected:", socket.id));
  socket.on("disconnect", () => console.log("[ext] socket disconnected"));
  socket.on("connect_error", (e) => console.warn("[ext] socket connect_error:", e?.message || e));

  // Forward actions to tabs on supported domains
  socket.on("target-update", async (action) => {
    const tabs = await chrome.tabs.query({
      url: [
        "*://*.netflix.com/*",
        "*://*.youtube.com/*",
        "*://*.hulu.com/*",
        "*://*.disneyplus.com/*",
        "*://*.primevideo.com/*",
        "*://*.max.com/*"
      ]
    });

    for (const tab of tabs) {
      try { chrome.tabs.sendMessage(tab.id, { type: "gesture-action", action }); }
      catch { /* tab might not have content script yet */ }
    }
  });
}

// Lifecycle hooks
chrome.runtime.onInstalled.addListener(warmAndConnect);
chrome.runtime.onStartup.addListener(warmAndConnect);
chrome.storage.onChanged.addListener((ch) => { if (ch.serverUrl) warmAndConnect(); });
chrome.idle.onStateChanged.addListener((s) => { if (s === "active") warmAndConnect(); });

// Options page manual reconnect
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "reconnect-socket") {
    warmAndConnect().then(() => sendResponse({ ok: true }));
    return true;
  }
});
