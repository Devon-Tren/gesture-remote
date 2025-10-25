// pages/api/socket.js
import { Server as IOServer } from "socket.io";

export const config = { api: { bodyParser: false } };

// Global singleton to survive Next.js HMR (prevents double handleUpgrade)
global.__io = global.__io || null;

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
    console.log("✅ connected", socket.id);

    // Control -> Target broadcast
    socket.on("control-action", (action) => {
      console.log("📤 control-action:", action);
      io.emit("target-update", action);
    });

    socket.on("disconnect", (reason) => {
      console.log("❌ disconnected", socket.id, reason);
    });
  });

  res.status(200).json({ ok: true, created: true });
}
