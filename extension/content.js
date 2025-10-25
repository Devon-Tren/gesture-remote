// Runs on all pages; acts on streaming sites when a gesture arrives.

function findVideo() {
    const vids = Array.from(document.querySelectorAll("video"));
    if (!vids.length) return null;
    let best = null, bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const visible = window.getComputedStyle(v).visibility !== "hidden";
      if (visible && area > bestArea) { bestArea = area; best = v; }
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
        "font:14px system-ui;z-index:2147483647;transition:opacity .25s"
      ].join(";");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el.__t);
    el.__t = setTimeout(() => (el.style.opacity = "0"), 900);
  }
  
  function focusPlayer() {
    const v = findVideo();
    if (v && typeof v.focus === "function") { try { v.focus(); } catch {} }
  }
  
  function actionPause() {
    const v = findVideo();
    if (v) { try { v.pause(); } catch {} ; toast("⏸ Paused"); }
    else { key("k"); toast("⏸ Paused (keys)"); }
  }
  
  function actionUnpause() {
    const v = findVideo();
    if (v) { try { v.play(); } catch {} ; toast("▶️ Playing"); }
    else { key("k"); toast("▶️ Playing (keys)"); }
  }
  
  function actionNext() {
    const v = findVideo();
    if (v && !Number.isNaN(v.currentTime)) { try { v.currentTime += 10; } catch {} ; toast("➡️ Forward"); }
    else { key("ArrowRight"); toast("➡️ Forward (keys)"); }
  }
  
  function actionPrev() {
    const v = findVideo();
    if (v && !Number.isNaN(v.currentTime)) { try { v.currentTime -= 10; } catch {} ; toast("⬅️ Back"); }
    else { key("ArrowLeft"); toast("⬅️ Back (keys)"); }
  }
  
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "gesture-action") return;
    focusPlayer();
    switch (msg.action) {
      case "pause":   actionPause(); break;
      case "unpause": actionUnpause(); break;
      case "next":    actionNext(); break;
      case "prev":    actionPrev(); break;
    }
  });
  