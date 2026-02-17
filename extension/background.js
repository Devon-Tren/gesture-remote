// MV3 service worker (module)
// background.js
import { io } from "./vendor/socket.io.esm.min.js";


const DEFAULT_URL = "http://localhost:3000";   // your Next dev server
const DEFAULT_CHANNEL = "gesture-remote-dev";
const SOCKET_PATH = "/api/socket_io";

let socket = null;
let currentUrl = null;
let currentChannel = null;

function applyGestureInPage(gesture) {
  const valid = new Set(["play_pause", "volume_up", "volume_down", "seek_forward", "seek_backward"]);
  if (!gesture || gesture.type !== "gesture" || !valid.has(gesture.name)) return false;

  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) return false;

  let video = null;
  let bestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area > bestArea) {
      bestArea = area;
      video = v;
    }
  }
  if (!video) return false;

  if (gesture.name === "play_pause") {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    return true;
  }

  if (gesture.name === "seek_forward") {
    video.currentTime += 10;
    return true;
  }

  if (gesture.name === "seek_backward") {
    video.currentTime = Math.max(0, video.currentTime - 10);
    return true;
  }

  if (gesture.name === "volume_up") {
    video.muted = false;
    video.volume = Math.min(1, video.volume + 0.08);
    return true;
  }

  video.muted = false;
  video.volume = Math.max(0, video.volume - 0.08);
  return true;
}

async function getConnectionSettings() {
  const { serverUrl, channelKey } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_URL,
    channelKey: DEFAULT_CHANNEL,
  });
  return {
    serverUrl: serverUrl || DEFAULT_URL,
    channelKey: channelKey || DEFAULT_CHANNEL,
  };
}

async function warmAndConnect() {
  const { serverUrl: url, channelKey } = await getConnectionSettings();
  if (socket && currentUrl === url && currentChannel === channelKey && socket.connected) return;

  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
  currentUrl = url;
  currentChannel = channelKey;

  // Warm your Next.js API so the Socket.IO server is created (singleton)
  try { await fetch(new URL("/api/socket", url).toString(), { cache: "no-store" }); } catch {}

  socket = io(url, {
    path: SOCKET_PATH,
    auth: { role: "extension", channel: channelKey },
    transports: ["websocket", "polling"],
    reconnection: true
  });

  socket.on("connect", () => console.log("[ext] socket connected:", socket.id));
  socket.on("disconnect", () => console.log("[ext] socket disconnected"));
  socket.on("connect_error", (e) => console.warn("[ext] socket connect_error:", e?.message || e));

  // Forward gesture events to tabs on supported domains.
  socket.on("gesture", async (gesture) => {
    if (!gesture || gesture.type !== "gesture" || typeof gesture.name !== "string") return;

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
      let handled = false;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "gesture-event", gesture });
        handled = !!response?.ok;
      } catch {}

      if (!handled) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: applyGestureInPage,
            args: [gesture],
          });
        } catch {}
      }
    }
  });
}

// Lifecycle hooks
chrome.runtime.onInstalled.addListener(warmAndConnect);
chrome.runtime.onStartup.addListener(warmAndConnect);
chrome.storage.onChanged.addListener((ch) => { if (ch.serverUrl || ch.channelKey) warmAndConnect(); });
chrome.idle.onStateChanged.addListener((s) => { if (s === "active") warmAndConnect(); });

// Options page manual reconnect
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "reconnect-socket") {
    warmAndConnect().then(() => sendResponse({ ok: true }));
    return true;
  }
});
