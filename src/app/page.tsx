"use client";

import Link from "next/link";

export default function HomePage() {
  const openRuntimeTabs = () => {
    window.open("/control", "_blank", "noopener,noreferrer");
    window.open("/target", "_blank", "noopener,noreferrer");
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
      <section className="w-full max-w-2xl rounded-2xl border border-white/20 bg-black/40 p-6">
        <h1 className="text-2xl font-semibold">Gesture Remote Runtime</h1>
        <p className="text-sm text-gray-300 mt-2">
          Bare-bones execution launcher. Open both runtime pages, then start Control session.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={openRuntimeTabs}
            className="px-4 py-2 rounded-lg border border-white/30 bg-white/10 hover:bg-white/15"
          >
            Open Control + Connection
          </button>
          <Link
            href="/control"
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/5 hover:bg-white/10"
          >
            Open Control
          </Link>
          <Link
            href="/target"
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/5 hover:bg-white/10"
          >
            Open Connection
          </Link>
        </div>
      </section>
    </main>
  );
}
