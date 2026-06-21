export function newId(): string {
  // crypto.randomUUID() is available on globalThis in both Node 18+ and
  // browsers, so this stays import-free of node:crypto — required now that
  // newId() is also called from a "use client" component (src/app/local/page.tsx)
  // and must be bundleable for the browser.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
