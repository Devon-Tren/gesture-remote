import { Server } from "socket.io";

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
    console.log("Client connected");

    socket.on("gesture", (data) => {
      console.log("👉 Gesture received:", data);
      io.emit("gesture", data); // broadcast to everyone
    });
  });

  res.end();
}
