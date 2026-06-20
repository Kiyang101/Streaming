// Process-wide single-flight lock: only one upscale job runs at a time so the
// GPU and disk aren't thrashed by concurrent jobs.
let active: string | null = null;

export function tryAcquire(id: string): boolean {
  if (active) return false;
  active = id;
  return true;
}

export function release(id: string): void {
  if (active === id) active = null;
}

export function activeUpscale(): string | null {
  return active;
}
