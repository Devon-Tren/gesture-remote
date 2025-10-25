"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center"
      style={{ backgroundColor: "#00CED1" }} // bright cyan
    >
      {/* Title */}
      <h1 className="text-7xl font-extrabold text-white mb-16 drop-shadow-lg border-8 border-white px-12 py-8 rounded-xl">
        Gesture Remote
      </h1>

      {/* Buttons */}
      <div className="flex gap-12">
        <Link
          href="/control"
          className="px-12 py-6 rounded-xl border-8 border-white text-white text-3xl font-bold shadow-lg hover:scale-110 transition"
        >
          Control
        </Link>
        <Link
          href="/target"
          className="px-12 py-6 rounded-xl border-8 border-white text-white text-3xl font-bold shadow-lg hover:scale-110 transition"
        >
          Target
        </Link>
      </div>
    </main>
  );
}
