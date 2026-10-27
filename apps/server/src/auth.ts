import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Accounts, isProvider, PROVIDERS, type Account, type Provider } from "./accounts.ts";
import type { Logger } from "./log.ts";

/** Where a service sends the player to sign in, and where the server asks who they are. */
export interface ProviderEndpoints {
  authorize: string;
  token: string;
  user: string;
  scope: string;
}

export const ENDPOINTS: Record<Provider, ProviderEndpoints> = {
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    user: "https://discord.com/api/v10/users/@me",
    scope: "identify",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    user: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
  },
};

export interface AuthOptions {
  /**
   * Address of the game as players reach it, such as https://nclsmgr.com/frontfall:
   * the services send players back under it, and the session cookie is limited to its path.
   */
  publicUrl: string;
  /** Signs the session cookies and keys the hash of the services' ids. Never change it. */
  sessionSecret: string;
  /** The applications registered with each service. A service left out offers no sign-in. */
  clients: Partial<Record<Provider, { id: string; secret: string }>>;
  /** Other addresses for the services, for tests. */
  endpoints?: Partial<Record<Provider, ProviderEndpoints>>;
}

export const SESSION_COOKIE = "frontfall_session";
const SIGN_IN_COOKIE = "frontfall_sign_in";
/** A player stays signed in this long after their last sign-in. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Time a player has to sign in at the service before coming back. */
const SIGN_IN_MS = 10 * 60 * 1000;
const SERVICE_TIMEOUT_MS = 10_000;
/** A rename sends a name, a few dozen bytes. */
const MAX_BODY_BYTES = 1024;

/** What `/api/me` tells the page: which buttons to show, and who is signed in. */
export interface Me {
  providers: Provider[];
  account: { name: string; provider: Provider } | null;
}

export interface Auth {
  /** Answers the sign-in routes and `/api/me`; false for any other path. */
  handle(request: IncomingMessage, response: ServerResponse, path: string): boolean;
  /** The account signed in on this request, from its session cookie. */
  accountOf(request: IncomingMessage): Account | undefined;
  /** Account holding a name, or one that looks like it: guests may not play under it. */
  owner(name: string): Account | undefined;
  readonly accounts: Accounts;
}

/**
 * Sign-in with Discord or Google, done by the server itself with OAuth 2.0
 * and PKCE: the page only follows links. The player gets a signed cookie
 * that the page cannot read, sent with every request and the game socket.
 */
export function createAuth(
  options: AuthOptions,
  accounts: Accounts,
  logger: Logger,
  isAllowedOrigin: (origin: string | undefined) => boolean,
  now: () => number = Date.now,
): Auth {
  const base = new URL(options.publicUrl.replace(/\/*$/, "/"));
  const secure = base.protocol === "https:";
  const cookiePath = base.pathname;
  const providers = PROVIDERS.filter((provider) => options.clients[provider] !== undefined);
  const endpoints = (provider: Provider): ProviderEndpoints =>
    options.endpoints?.[provider] ?? ENDPOINTS[provider];
  const redirectUri = (provider: Provider): string =>
    new URL(`auth/${provider}/callback`, base).href;

  const sign = (purpose: string, payload: string): string =>
    createHmac("sha256", options.sessionSecret).update(`${purpose}:${payload}`).digest("base64url");
  /** `payload.mac`, or undefined when the mac does not match. */
  const verify = (purpose: string, value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const dot = value.lastIndexOf(".");
    if (dot < 0) return undefined;
    const payload = value.slice(0, dot);
    const given = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(sign(purpose, payload));
    return given.length === expected.length && timingSafeEqual(given, expected)
      ? payload
      : undefined;
  };

  const cookie = (name: string, value: string, maxAgeMs: number, path = cookiePath): string =>
    [
      `${name}=${value}`,
      `Path=${path}`,
      `Max-Age=${String(Math.floor(maxAgeMs / 1000))}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");

  function accountOf(request: IncomingMessage): Account | undefined {
    const payload = verify("session", readCookie(request, SESSION_COOKIE));
    if (payload === undefined) return undefined;
    const [id = "", expires = ""] = payload.split(".");
    if (!(Number(expires) > now())) return undefined;
    return accounts.get(id);
  }

  function me(account: Account | undefined): Me {
    return {
      providers,
      account: account ? { name: account.name, provider: account.provider } : null,
    };
  }

  /** Back to the menu, with a word for the page when the sign-in did not go through. */
  function home(response: ServerResponse, cookies: string[], failed: boolean): void {
    response
      .writeHead(302, {
        location: failed ? new URL("?signin=failed", base).href : base.href,
        "set-cookie": cookies,
        "cache-control": "no-store",
      })
      .end();
  }

  function start(provider: Provider, response: ServerResponse): void {
    const client = options.clients[provider];
    if (!client) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const state = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const payload = `${provider}.${state}.${verifier}.${String(now() + SIGN_IN_MS)}`;
    const target = new URL(endpoints(provider).authorize);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: client.id,
      redirect_uri: redirectUri(provider),
      scope: endpoints(provider).scope,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: provider === "discord" ? "none" : "select_account",
    }).toString();
    response
      .writeHead(302, {
        location: target.href,
        "set-cookie": cookie(
          SIGN_IN_COOKIE,
          `${payload}.${sign("sign-in", payload)}`,
          SIGN_IN_MS,
          `${cookiePath}auth/`,
        ),
        "cache-control": "no-store",
      })
      .end();
  }

  async function finish(
    provider: Provider,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const clear = cookie(SIGN_IN_COOKIE, "", 0, `${cookiePath}auth/`);
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const payload = verify("sign-in", readCookie(request, SIGN_IN_COOKIE));
    const [started = "", state = "", verifier = "", expires = ""] = payload?.split(".") ?? [];
    const client = options.clients[provider];
    // The player said no at the service: back to the menu without a fuss.
    if (query.get("error") === "access_denied") {
      home(response, [clear], false);
      return;
    }
    const code = query.get("code");
    if (
      !client ||
      code === null ||
      started !== provider ||
      query.get("state") !== state ||
      !(Number(expires) > now())
    ) {
      logger.warn("sign_in_failed", { provider, reason: "state" });
      home(response, [clear], true);
      return;
    }
    let account: Account;
    try {
      const { id, name } = await identify(provider, client, code, verifier);
      account = accounts.signIn(provider, id, name, now());
    } catch (error) {
      logger.warn("sign_in_failed", { provider, reason: (error as Error).message });
      home(response, [clear], true);
      return;
    }
    const session = `${account.id}.${String(now() + SESSION_MS)}`;
    home(
      response,
      [clear, cookie(SESSION_COOKIE, `${session}.${sign("session", session)}`, SESSION_MS)],
      false,
    );
  }

  /** Trades the code for a token, then asks the service who the player is. */
  async function identify(
    provider: Provider,
    client: { id: string; secret: string },
    code: string,
    verifier: string,
  ): Promise<{ id: string; name: string }> {
    const { token: tokenUrl, user: userUrl } = endpoints(provider);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(provider),
        client_id: client.id,
        client_secret: client.secret,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) throw new Error(`token ${String(tokenResponse.status)}`);
    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== "string") throw new Error("token missing");
    const userResponse = await fetch(userUrl, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!userResponse.ok) throw new Error(`user ${String(userResponse.status)}`);
    const user = (await userResponse.json()) as Record<string, unknown>;
    const id = provider === "discord" ? user.id : user.sub;
    if (typeof id !== "string" || id === "") throw new Error("user id missing");
    const names =
      provider === "discord" ? [user.global_name, user.username] : [user.given_name, user.name];
    return { id, name: names.find((name): name is string => typeof name === "string") ?? "" };
  }

  /** Changes to an account come from the game's own pages only. */
  function sameSite(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return origin !== undefined && isAllowedOrigin(origin);
  }

  function json(
    response: ServerResponse,
    status: number,
    body: unknown,
    cookies: string[] = [],
  ): void {
    response
      .writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...(cookies.length > 0 && { "set-cookie": cookies }),
      })
      .end(JSON.stringify(body));
  }

  function rename(account: Account, request: IncomingMessage, response: ServerResponse): void {
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      json(response, 415, { error: "invalid", message: "JSON expected" });
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      let name: unknown;
      try {
        name = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { name?: unknown }).name;
      } catch {
        name = undefined;
      }
      if (typeof name !== "string") {
        json(response, 400, { error: "invalid", message: "a name is expected" });
        return;
      }
      const result = accounts.rename(account.id, name);
      if (result.ok) json(response, 200, me(account));
      else json(response, result.error === "taken" ? 409 : 400, result);
    });
  }

  function handle(request: IncomingMessage, response: ServerResponse, path: string): boolean {
    const method = request.method ?? "GET";
    if (path === "/auth/logout") {
      if (method !== "POST" || !sameSite(request)) {
        response.writeHead(method === "POST" ? 403 : 405, { allow: "POST" }).end();
        return true;
      }
      json(response, 200, me(undefined), [cookie(SESSION_COOKIE, "", 0)]);
      return true;
    }
    const signIn = /^\/auth\/([a-z]+)(\/callback)?$/.exec(path);
    if (signIn) {
      const provider = signIn[1] ?? "";
      if (method !== "GET" || !isProvider(provider)) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      } else if (signIn[2]) {
        void finish(provider, request, response);
      } else {
        start(provider, response);
      }
      return true;
    }
    if (path !== "/api/me") return false;
    const account = accountOf(request);
    if (method === "GET" || method === "HEAD") {
      json(response, 200, me(account));
      return true;
    }
    if ((method !== "POST" && method !== "DELETE") || !sameSite(request)) {
      response
        .writeHead(method === "POST" || method === "DELETE" ? 403 : 405, {
          allow: "GET, HEAD, POST, DELETE",
        })
        .end();
      return true;
    }
    if (!account) {
      json(response, 401, { error: "signed_out", message: "not signed in" });
      return true;
    }
    if (method === "POST") {
      rename(account, request, response);
      return true;
    }
    accounts.remove(account.id);
    logger.info("account_deleted", { provider: account.provider });
    json(response, 200, me(undefined), [cookie(SESSION_COOKIE, "", 0)]);
    return true;
  }

  return { handle, accountOf, owner: (name) => accounts.owner(name), accounts };
}

/** A cookie of the request, by name; the first one if the browser sent it twice. */
export function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
