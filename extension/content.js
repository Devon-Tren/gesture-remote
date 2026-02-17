// Runs on all pages; acts on streaming sites when a gesture event arrives.

const GESTURE_NAMES = new Set([
  "play_pause",
  "volume_up",
  "volume_down",
  "seek_forward",
  "seek_backward",
]);

const COOLDOWN_MS = {
  play_pause: 280,
  volume_up: 120,
  volume_down: 120,
  seek_forward: 220,
  seek_backward: 220,
};

const lastActionAt = Object.create(null);

function findVideo() {
  const vids = Array.from(document.querySelectorAll("video"));
  if (!vids.length) return null;
  let best = null;
  let bestArea = 0;
  for (const v of vids) {
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    const visible = window.getComputedStyle(v).visibility !== "hidden";
    if (visible && area > bestArea) {
      bestArea = area;
      best = v;
    }
  }
  return best;
}

function key(k) {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
}

function toast(msg) {
  let el = document.getElementById("__gesture_toast__");
  if (!el) {
    el = document.createElement("div");
    el.id = "__gesture_toast__";
    el.style.cssText = [
      "position:fixed;right:24px;bottom:24px;padding:10px 14px",
      "border-radius:12px;background:rgba(0,0,0,.65);color:#fff",
      "font:14px system-ui;z-index:2147483647;transition:opacity .25s",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el.__t);
  el.__t = setTimeout(() => (el.style.opacity = "0"), 900);
}

function isGestureEvent(gesture) {
  return (
    gesture &&
    gesture.type === "gesture" &&
    typeof gesture.name === "string" &&
    GESTURE_NAMES.has(gesture.name) &&
    typeof gesture.confidence === "number" &&
    Number.isFinite(gesture.confidence) &&
    gesture.confidence >= 0 &&
    gesture.confidence <= 1 &&
    typeof gesture.timestamp === "number" &&
    Number.isFinite(gesture.timestamp)
  );
}

function blockedByCooldown(name) {
  const now = Date.now();
  const last = lastActionAt[name] || 0;
  const cooldown = COOLDOWN_MS[name] || 200;
  if (now - last < cooldown) return true;
  lastActionAt[name] = now;
  return false;
}

function focusPlayer() {
  const v = findVideo();
  if (v && typeof v.focus === "function") {
    try {
      v.focus();
    } catch {}
  }
}

function actionPlayPause() {
  const v = findVideo();
  if (v) {
    if (v.paused) {
      v.play().catch(() => {});
      toast("▶ Playing");
    } else {
      v.pause();
      toast("⏸ Paused");
    }
    return;
  }

  key("k");
  toast("⏯ Toggle");
}

function actionSeekForward() {
  const v = findVideo();
  if (v && !Number.isNaN(v.currentTime)) {
    v.currentTime += 10;
    toast("➡ Seek +10s");
    return;
  }

  key("ArrowRight");
  toast("➡ Seek +10s (keys)");
}

function actionSeekBackward() {
  const v = findVideo();
  if (v && !Number.isNaN(v.currentTime)) {
    v.currentTime = Math.max(0, v.currentTime - 10);
    toast("⬅ Seek -10s");
    return;
  }

  key("ArrowLeft");
  toast("⬅ Seek -10s (keys)");
}

function actionVolumeUp() {
  const v = findVideo();
  if (v) {
    v.muted = false;
    v.volume = Math.min(1, v.volume + 0.08);
    toast(`🔊 Volume ${Math.round(v.volume * 100)}%`);
    return;
  }

  key("ArrowUp");
  toast("🔊 Volume +");
}

function actionVolumeDown() {
  const v = findVideo();
  if (v) {
    v.muted = false;
    v.volume = Math.max(0, v.volume - 0.08);
    toast(`🔉 Volume ${Math.round(v.volume * 100)}%`);
    return;
  }

  key("ArrowDown");
  toast("🔉 Volume -");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "gesture-event" || !isGestureEvent(msg.gesture)) return;
  const { name } = msg.gesture;
  if (blockedByCooldown(name)) {
    sendResponse({ ok: false, reason: "cooldown" });
    return;
  }

  focusPlayer();
  switch (name) {
    case "play_pause":
      actionPlayPause();
      break;
    case "seek_forward":
      actionSeekForward();
      break;
    case "seek_backward":
      actionSeekBackward();
      break;
    case "volume_up":
      actionVolumeUp();
      break;
    case "volume_down":
      actionVolumeDown();
      break;
    default:
      break;
  }
  sendResponse({ ok: true });
  return true;
});
  
