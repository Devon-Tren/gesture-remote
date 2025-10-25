"use client";

import { useEffect, useRef } from "react";
import { Hands, HAND_CONNECTIONS } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { io } from "socket.io-client";

// 👇 connect to API route
const socket = io("http://localhost:3000", { path: "/socket.io" });

export default function ControlPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults((results) => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 4,
          });
          drawLandmarks(ctx, landmarks, { color: "#FF0000", lineWidth: 2 });

          // 👌 Pinch Detector
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const dx = thumbTip.x - indexTip.x;
          const dy = thumbTip.y - indexTip.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 0.05) {
            socket.emit("gesture", { action: "next" });
          }
        }
      }
    });

    const camera = new Camera(videoRef.current!, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  }, []);

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6"
      style={{ backgroundColor: "#00CED1" }}
    >
      <h1 className="text-5xl font-extrabold text-white drop-shadow-lg">
        Control Mode
      </h1>

      <video ref={videoRef} className="hidden" />
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        className="border-4 border-white rounded-xl shadow-lg"
      />
    </main>
  );
}
