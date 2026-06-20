"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Left navigation rail (YouTube-style chrome).
 *
 * Presentational: the `collapsed` flag is owned by AppShell. When collapsed the
 * rail shrinks to an icon-only strip; when expanded it shows icon + label.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z" />
      </svg>
    ),
  },
  {
    href: "/live/devkey",
    label: "Live",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4zM5.6 5.6l1.4 1.4a7 7 0 000 10l-1.4 1.4a9 9 0 010-12.8zm12.8 0a9 9 0 010 12.8L17 17a7 7 0 000-10l1.4-1.4z" />
      </svg>
    ),
  },
];

/**
 * Returns true when the current route should highlight the given nav item.
 * Home matches only the exact root; Live matches any `/live/*` route.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href.startsWith("/live")) return pathname.startsWith("/live");
  return pathname === href;
}

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary"
      className={`fixed bottom-0 left-0 top-14 z-20 overflow-y-auto bg-yt-bg py-2 transition-[width] duration-200 ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <ul className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-lg text-yt-text hover:bg-yt-surface ${
                  active ? "bg-yt-surface font-medium" : ""
                } ${
                  collapsed
                    ? "flex-col gap-1 px-1 py-3 text-[10px]"
                    : "gap-5 px-3 py-2.5 text-sm"
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className={collapsed ? "leading-none" : ""}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
