const DEFAULT_URL = "http://localhost:3000";
const DEFAULT_CHANNEL = "gesture-remote-dev";

async function load() {
  const { serverUrl, channelKey } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_URL,
    channelKey: DEFAULT_CHANNEL,
  });
  document.getElementById("url").value = serverUrl || DEFAULT_URL;
  document.getElementById("channelKey").value = channelKey || DEFAULT_CHANNEL;
}
load();

document.getElementById("save").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim() || DEFAULT_URL;
  const channelKey = document.getElementById("channelKey").value.trim() || DEFAULT_CHANNEL;
  await chrome.storage.sync.set({ serverUrl: url, channelKey });
  alert("Saved.");
});

document.getElementById("reconnect").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "reconnect-socket" }, () => {
    // ignore lastError if service worker is sleeping; it will wake on next action
    alert("Reconnecting…");
  });
});
