import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientAddress, isLocalRequest, isPrivateAddress } from "../src/address.ts";

function request(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.5",
    "192.168.1.20",
    "::1",
    "fd00::1",
    "::ffff:172.20.0.2",
  ])("trusts %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "203.0.113.9",
    "172.32.0.1",
    "8.8.8.8",
    "2001:db8::1",
    "::ffff:8.8.8.8",
    "",
    "nonsense",
  ])("does not trust %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("does not trust a missing address", () => {
    expect(isPrivateAddress(undefined)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("believes X-Client-IP from a proxy on the private network", () => {
    expect(clientAddress(request("172.18.0.3", { "x-client-ip": " 203.0.113.9 " }))).toBe(
      "203.0.113.9",
    );
  });

  it("ignores X-Client-IP from anyone else", () => {
    expect(clientAddress(request("198.51.100.4", { "x-client-ip": "203.0.113.9" }))).toBe(
      "198.51.100.4",
    );
  });

  it("falls back to the peer address", () => {
    expect(clientAddress(request("127.0.0.1"))).toBe("127.0.0.1");
  });
});

describe("isLocalRequest", () => {
  it("accepts requests from the host that no proxy forwarded", () => {
    expect(isLocalRequest(request("127.0.0.1"))).toBe(true);
    expect(isLocalRequest(request("172.18.0.1"))).toBe(true);
  });

  it("refuses forwarded or remote requests", () => {
    expect(isLocalRequest(request("172.18.0.3", { "x-forwarded-for": "1.2.3.4" }))).toBe(false);
    expect(isLocalRequest(request("203.0.113.9"))).toBe(false);
  });
});
