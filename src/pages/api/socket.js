import { Server } from "socket.io";
import { isGestureEvent } from "../../lib/gesture-event";

const CHANNEL_KEY = process.env.GESTURE_REMOTE_CHANNEL || "gesture-remote-dev";
const MAX_EVENT_AGE_MS = 8000;

export default function handler(req, res) {
  if (res.socket.server.io) {
    console.log("✅ Socket.io already running");
    res.end();
    return;
  }

  console.log("🚀 Starting Socket.io server...");

  const io = new Server(res.socket.server, {
    cors: { origin: "*" },
  });

  res.socket.server.io = io;

  io.on("connection", (socket) => {
    const auth = socket.handshake?.auth || {};
    const role = auth?.role;
    const channel = auth?.channel;
    if (channel !== CHANNEL_KEY) {
      socket.disconnect(true);
      return;
    }
    if (role !== "control" && role !== "extension" && role !== "monitor") {
      socket.disconnect(true);
      return;
    }
    socket.data.role = role;
    socket.data.lastGestureTs = 0;

    socket.on("gesture", (data) => {
      if (socket.data.role !== "control") return;
      if (!isGestureEvent(data)) {
        console.warn("⚠️ invalid gesture payload ignored");
        return;
      }
      const now = Date.now();
      if (Math.abs(now - data.timestamp) > MAX_EVENT_AGE_MS) return;
      if (data.timestamp <= socket.data.lastGestureTs) return;
      socket.data.lastGestureTs = data.timestamp;
      io.emit("gesture", data); // broadcast to everyone
    });
  });

  res.end();
}
