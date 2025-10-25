const { Server } = require("socket.io");
const http = require("http");

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("gesture", (data) => {
    console.log("Gesture received:", data);
    io.emit("gesture", data); // broadcast to all clients
  });
});

server.listen(4000, () => {
  console.log("WebSocket server running on http://localhost:4000");
});
