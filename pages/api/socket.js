// pages/api/socket.js
import { Server as IOServer } from "socket.io";
import { isGestureEvent } from "../../src/lib/gesture-event";

export const config = { api: { bodyParser: false } };

// Global singleton to survive Next.js HMR (prevents double handleUpgrade)
global.__io = global.__io || null;

const CHANNEL_KEY = process.env.GESTURE_REMOTE_CHANNEL || "gesture-remote-dev";
const MAX_EVENT_AGE_MS = 8000;
const ROLE_ROOM = {
  extension: "role:extension",
  monitor: "role:monitor",
};

export default function handler(req, res) {
  if (global.__io) {
    res.status(200).json({ ok: true, reused: true });
    return;
  }

  const httpServer = res.socket?.server;
  if (!httpServer) {
    res.status(500).json({ ok: false, error: "No HTTP server on res.socket.server" });
    return;
  }

  const io = new IOServer(httpServer, {
    path: "/api/socket_io",
    addTrailingSlash: false,
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  global.__io = io;

  io.on("connection", (socket) => {
    const auth = socket.handshake?.auth || {};
    const role = auth?.role;
    const channel = auth?.channel;
    if (channel !== CHANNEL_KEY) {
      console.warn("⛔ rejected socket with invalid channel:", socket.id);
      socket.disconnect(true);
      return;
    }

    if (role !== "control" && role !== "extension" && role !== "monitor") {
      console.warn("⛔ rejected socket with invalid role:", socket.id, role);
      socket.disconnect(true);
      return;
    }

    if (role === "extension") socket.join(ROLE_ROOM.extension);
    if (role === "monitor") socket.join(ROLE_ROOM.monitor);
    socket.data.role = role;
    socket.data.lastGestureTs = 0;
    console.log("✅ connected", socket.id, role);

    socket.on("gesture", (payload) => {
      if (socket.data.role !== "control") {
        console.warn("⛔ non-control socket tried to emit gesture:", socket.id);
        return;
      }
      if (!isGestureEvent(payload)) {
        console.warn("⚠️ invalid gesture payload ignored");
        return;
      }
      const now = Date.now();
      if (Math.abs(now - payload.timestamp) > MAX_EVENT_AGE_MS) {
        console.warn("⚠️ stale gesture payload ignored");
        return;
      }
      if (payload.timestamp <= socket.data.lastGestureTs) {
        console.warn("⚠️ non-monotonic gesture timestamp ignored");
        return;
      }
      socket.data.lastGestureTs = payload.timestamp;

      io.to(ROLE_ROOM.extension).emit("gesture", payload);
      io.to(ROLE_ROOM.monitor).emit("gesture", payload);
    });

    socket.on("disconnect", (reason) => {
      console.log("❌ disconnected", socket.id, reason);
    });
  });

  res.status(200).json({ ok: true, created: true });
}
