import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Video, VideoStatus } from "./types";

let db: Database.Database | null = null;

export function openDb(file?: string): Database.Database {
  const target = file ?? path.join(process.cwd(), "media", "library.db");
  if (!file || file !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  db = new Database(target);
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      path TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
  return db;
}

function conn(): Database.Database {
  if (!db) openDb();
  return db!;
}

export function insertVideo(v: Video): void {
  conn()
    .prepare(`INSERT INTO videos (id, title, type, status, path, createdAt) VALUES (@id, @title, @type, @status, @path, @createdAt)`)
    .run(v);
}

export function listVideos(): Video[] {
  return conn().prepare(`SELECT * FROM videos ORDER BY createdAt DESC`).all() as Video[];
}

export function getVideo(id: string): Video | undefined {
  return conn().prepare(`SELECT * FROM videos WHERE id = ?`).get(id) as Video | undefined;
}

export function setStatus(id: string, status: VideoStatus): void {
  conn().prepare(`UPDATE videos SET status = ? WHERE id = ?`).run(status, id);
}
