// src/lib/fileAccess.ts

/** True when the File System Access API is available (lets us persist handles
 *  and re-acquire files across reloads). Absent in some embedded webviews such
 *  as VS Code's Simple Browser, where the caller falls back to <input type=file>. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

/** Open the system picker for one or more video files. Rejects with an
 *  AbortError if the user cancels — callers should swallow that. */
export async function pickFiles(): Promise<FileSystemFileHandle[]> {
  return await window.showOpenFilePicker({ multiple: true });
}

/** Ensure read permission for a stored handle. queryPermission avoids a prompt
 *  when already granted; requestPermission MUST be called from a user gesture.
 *  Returns true only when read access is granted. */
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Read-only check (no prompt) used at restore time to mark already-granted
 *  handles as ready without interrupting the user. */
export async function hasReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: "read" })) === "granted";
}

/** Resolve a handle to a File for object-URL playback. */
export async function fileFromHandle(handle: FileSystemFileHandle): Promise<File> {
  return await handle.getFile();
}
