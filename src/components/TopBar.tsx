"use client";

/**
 * Persistent top app bar (YouTube-style chrome).
 *
 * Purely presentational: collapse state is owned by AppShell, which passes the
 * toggle handler down. Keeping state out of this component lets both the bar and
 * the sidebar react to the same source of truth without prop drilling cycles.
 */
export default function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-4 bg-yt-bg px-4">
      {/* Left cluster: hamburger + brand */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="grid h-10 w-10 place-items-center rounded-full text-yt-text hover:bg-yt-surface"
        >
          {/* Hamburger icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
          </svg>
        </button>
        <span className="flex select-none items-center gap-1 text-lg font-bold tracking-tight text-yt-text">
          <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
            <rect width="28" height="20" rx="5" className="fill-yt-red" />
            <path d="M11 5.5l7 4.5-7 4.5v-9z" fill="#fff" />
          </svg>
          Stream
        </span>
      </div>

      {/* Center: search placeholder (non-functional input per task scope) */}
      <div className="mx-auto flex w-full max-w-xl items-center">
        <input
          type="search"
          placeholder="Search"
          aria-label="Search"
          className="w-full rounded-l-full border border-neutral-700 bg-yt-bg px-4 py-2 text-sm text-yt-text placeholder:text-yt-subtext focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Search"
          className="rounded-r-full border border-l-0 border-neutral-700 bg-yt-surface px-5 py-2 text-yt-subtext hover:bg-neutral-700"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z" />
          </svg>
        </button>
      </div>

      {/* Right cluster: action icons (decorative placeholders per task scope) */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Create"
          className="grid h-10 w-10 place-items-center rounded-full text-yt-text hover:bg-yt-surface"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 5a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H6a1 1 0 110-2h5V6a1 1 0 011-1z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Account"
          className="grid h-9 w-9 place-items-center rounded-full bg-yt-surface text-sm font-medium text-yt-text"
        >
          U
        </button>
      </div>
    </header>
  );
}
