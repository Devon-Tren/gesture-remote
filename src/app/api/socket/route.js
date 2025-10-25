import { Server } from "socket.io";

let io;

export async function GET(req) {
  if (!io) {
    console.log("🚀 Starting Socket.io server...");

    const { socket } = req;
    io = new Server(socket.server, {
      cors: { origin: "*" },
    });

    socket.server.io = io;

    io.on("connection", (socket) => {
      console.log("✅ Client connected");

      socket.on("gesture", (data) => {
        console.log("👉 Gesture received:", data);
        io.emit("gesture", data);
      });
    });
  } else {
    console.log("⚡ Socket.io already running");
  }

  return new Response("Socket server running", { status: 200 });
}
