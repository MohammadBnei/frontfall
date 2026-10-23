import { randomBytes } from "node:crypto";

/** 72 random bits in 12 URL-safe characters: short enough to share, too many to guess. */
export function newGameId(): string {
  return randomBytes(9).toString("base64url");
}

/** 128 random bits: a reconnect token is a password for one seat. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}
