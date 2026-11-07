import { db } from "./db.ts";
import { createHash } from "node:crypto";
// Shared fixed-window counters: atomic upsert works across serverless instances.
export class DatabaseRateLimitStore {
  localKeys = false;
  private windowMs = 60000;
  private cleanupAt = 0;
  constructor(public prefix: string) {}
  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }
  private key(key: string) {
    return `${this.prefix}:${Math.floor(Date.now() / this.windowMs)}:${createHash("sha256").update(key).digest("hex")}`;
  }
  async increment(key: string) {
    if (Date.now() > this.cleanupAt) {
      this.cleanupAt = Date.now() + 60000;
      await db.rateLimit.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    }
    const expiresAt = new Date(
      (Math.floor(Date.now() / this.windowMs) + 1) * this.windowMs,
    );
    const bucketKey = this.key(key);
    const row = await db.rateLimit.upsert({
      where: { key: bucketKey },
      create: { key: bucketKey, total: 1, expiresAt },
      update: { total: { increment: 1 } },
    });
    return { totalHits: row.total, resetTime: row.expiresAt };
  }
  async decrement(key: string) {
    await db.rateLimit.updateMany({
      where: { key: this.key(key), total: { gt: 0 } },
      data: { total: { decrement: 1 } },
    });
  }
  async resetKey(key: string) {
    await db.rateLimit.deleteMany({ where: { key: this.key(key) } });
  }
}
