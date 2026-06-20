import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(8).toString("hex");
}
