"use client";

import { useState } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";

/**
 * Persistent application chrome shared by every route.
 *
 * Owns the single source of truth for sidebar collapse state and composes the
 * top bar, the left rail, and the offset main content region. Rendered from the
 * server RootLayout, but is itself a client component because the collapse
 * toggle needs interactive state.
 *
 * Layout model:
 *  - TopBar is fixed at the top (h-14).
 *  - Sidebar is fixed below the top bar; its width animates between 72px
 *    (collapsed) and 240px (expanded).
 *  - <main> is offset by the top bar height and the current sidebar width so
 *    page content never sits underneath the chrome.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} />
      <Sidebar collapsed={collapsed} />
      <main
        className={`min-h-screen pt-14 transition-[padding] duration-200 ${
          collapsed ? "pl-[72px]" : "pl-60"
        }`}
      >
        {children}
      </main>
    </>
  );
}
