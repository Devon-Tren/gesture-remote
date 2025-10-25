const DEFAULT_URL = "http://localhost:3000";

async function load() {
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_URL });
  document.getElementById("url").value = serverUrl || DEFAULT_URL;
}
load();

document.getElementById("save").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim() || DEFAULT_URL;
  await chrome.storage.sync.set({ serverUrl: url });
  alert("Saved.");
});

document.getElementById("reconnect").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "reconnect-socket" }, () => {
    // ignore lastError if service worker is sleeping; it will wake on next action
    alert("Reconnecting…");
  });
});
