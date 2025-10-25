"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export default function TargetPage() {
  const [label, setLabel] = useState("Listening…");
  const [connected, setConnected] = useState(false);
  const [sid, setSid] = useState<string>("");
  const socketRef = useRef<Socket | null>(null);

  const key = (k: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

  useEffect(() => {
    let active = true;

    const init = async () => {
      // Warm the API route so the singleton is created (or reused)
      try { await fetch("/api/socket"); } catch (e) { console.warn("[target] warmup failed", e); }

      const s = io("/", {
        path: "/api/socket_io",
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 500,
      });

      if (!active) return;
      socketRef.current = s;

      s.on("connect", () => {
        setConnected(true);
        setSid(s.id ?? "");
        console.log("[target] connected", s.id);
      });
      s.on("connect_error", (err) => console.error("[target] connect_error", err));
      s.on("disconnect", (reason) => {
        setConnected(false);
        console.log("[target] disconnect", reason);
      });

      s.on("target-update", (action: string) => {
        console.log("[target] received:", action);
        const video = document.querySelector("video") as HTMLVideoElement | null;

        if (action === "pause") {
          setLabel("⏸ Paused");
          if (video) video.pause();
          else key("k");
        } else if (action === "unpause") {
          setLabel("▶️ Playing");
          if (video) { video.play().catch(() => {}); }
          else key("k");
        } else if (action === "next") {
          setLabel("➡️ Next");
          key("ArrowRight");
        } else if (action === "prev") {
          setLabel("⬅️ Previous");
          key("ArrowLeft");
        }
      });
    };

    init();
    return () => {
      active = false;
      socketRef.current?.close(); // fully dispose
    };
  }, []);

  return (
    <main className="min-h-screen bg-black flex items-center justify-center">
      <div className="px-6 py-4 bg-white/10 text-white rounded-2xl border border-white/15 shadow-xl">
        <div className="flex items-center justify-between gap-6">
          <h1 className="text-lg font-semibold">Target</h1>
          <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-emerald-500/30 text-emerald-200" : "bg-rose-500/30 text-rose-200"}`}>
            socket: {connected ? "connected" : "disconnected"}{sid ? ` (${sid.slice(0,6)})` : ""}
          </span>
        </div>
        <div className="text-3xl mt-2">{label}</div>
        <p className="text-xs text-gray-400 mt-1">Keep this tab focused so key events reach streaming sites.</p>
      </div>
    </main>
  );
}
