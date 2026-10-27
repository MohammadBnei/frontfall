import { getLanguage, onLanguageChange, type Language } from "../i18n/index.ts";
import { h } from "./dom.ts";
import "./account.css";

type Provider = "discord" | "google";

/** What the server says at `/api/me`: which services to offer, and who is signed in. */
interface Me {
  providers: Provider[];
  account: { name: string; provider: Provider } | null;
}

/**
 * The box's own words: the module and its styles load after the menu shows,
 * so they stay out of the first visit's code.
 */
const TEXT = {
  en: {
    offer: "Optional: sign in to keep your name for yourself with",
    signedIn: "Signed in with {service}. Your name is yours alone.",
    signOut: "Sign out",
    delete: "Delete my account",
    deleteConfirm: "Delete your account? Your name will be free for anyone to take.",
    failed: "Signing in did not work. You can try again, or play as a guest.",
    taken: "Another player already holds this name.",
    invalid: "This name is not allowed.",
  },
  fr: {
    offer: "Facultatif : connectez-vous pour garder votre nom avec",
    signedIn: "Connecté avec {service}. Ce nom n'est qu'à vous.",
    signOut: "Se déconnecter",
    delete: "Supprimer mon compte",
    deleteConfirm: "Supprimer votre compte ? Votre nom redeviendra libre pour tout le monde.",
    failed: "La connexion n'a pas abouti. Vous pouvez réessayer, ou jouer en invité.",
    taken: "Un autre joueur a déjà ce nom.",
    invalid: "Ce nom n'est pas autorisé.",
  },
} satisfies Record<Language, Record<string, string>>;

type TextKey = keyof (typeof TEXT)["en"];

function text(key: TextKey, service = ""): string {
  return TEXT[getLanguage()][key].replace("{service}", service);
}

const PROVIDER_NAMES: Record<Provider, string> = { discord: "Discord", google: "Google" };

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const me = value as Partial<Me>;
  return Array.isArray(me.providers) && (me.account === null || typeof me.account === "object");
}

/**
 * Optional sign-in, under the name field: a player who signs in with Discord
 * or Google keeps their name for themselves. Shows nothing when the server
 * offers no service, or cannot be reached: the game is played as a guest.
 */
export class AccountBox {
  readonly element = h("div", { class: "account", hidden: true, "aria-live": "polite" });
  private me: Me | undefined;
  private message: TextKey | undefined;
  /** Stops following the language once the menu is gone. */
  readonly dispose: () => void;

  /**
   * @param name the name field of the menu: signed in, it shows and renames the account.
   * @param setName tells the menu the name changed.
   */
  constructor(
    private readonly name: HTMLInputElement,
    private readonly setName: (name: string) => void,
  ) {
    const query = new URLSearchParams(location.search);
    if (query.get("signin") === "failed") {
      this.message = "failed";
      query.delete("signin");
      const search = query.toString();
      history.replaceState(history.state, "", `${location.pathname}${search && `?${search}`}`);
    }
    name.addEventListener("change", () => {
      if (this.me?.account) void this.rename(name.value);
    });
    this.dispose = onLanguageChange(() => {
      this.show(this.me);
    });
    void this.load();
  }

  private async load(): Promise<void> {
    const me = await this.request("GET");
    if (me) this.show(me);
  }

  /** Sends a request to `/api/me` or `/auth/logout`; undefined when it fails. */
  private async request(
    method: "GET" | "POST" | "DELETE",
    path = "api/me",
    body?: unknown,
  ): Promise<Me | undefined> {
    try {
      const response = await fetch(new URL(path, location.href), {
        method,
        credentials: "same-origin",
        cache: "no-store",
        ...(body !== undefined && {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
      if (response.status === 409) this.message = "taken";
      else if (response.status === 400) this.message = "invalid";
      if (!response.ok) return undefined;
      const value: unknown = await response.json();
      return isMe(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async rename(raw: string): Promise<void> {
    const me = await this.request("POST", "api/me", { name: raw });
    if (me) this.message = undefined;
    // A refused name goes back to the account's.
    this.show(me ?? this.me);
  }

  private async signOut(): Promise<void> {
    const me = await this.request("POST", "auth/logout");
    if (!me) return;
    // The account's name is no longer the player's to use as a guest.
    this.name.value = "";
    this.setName("");
    this.show(me);
  }

  private async remove(): Promise<void> {
    if (!confirm(text("deleteConfirm"))) return;
    const me = await this.request("DELETE");
    if (!me) return;
    this.name.value = "";
    this.setName("");
    this.show(me);
  }

  private show(me: Me | undefined): void {
    if (!me) return;
    this.me = me;
    const { account } = me;
    this.element.hidden = me.providers.length === 0 && !account;
    if (account) {
      this.name.value = account.name;
      this.setName(account.name);
    }
    const signOut = h("button", { type: "button", class: "link" }, text("signOut"));
    signOut.addEventListener("click", () => void this.signOut());
    const remove = h("button", { type: "button", class: "link" }, text("delete"));
    remove.addEventListener("click", () => void this.remove());
    const status = account
      ? h(
          "p",
          { class: "account-status" },
          text("signedIn", PROVIDER_NAMES[account.provider]),
          " ",
          signOut,
          " · ",
          remove,
        )
      : h(
          "p",
          { class: "account-status" },
          text("offer"),
          " ",
          ...me.providers.map((provider) =>
            h(
              "a",
              { class: `account-sign-in ${provider}`, href: `./auth/${provider}` },
              PROVIDER_NAMES[provider],
            ),
          ),
        );
    this.element.replaceChildren(
      status,
      ...(this.message ? [h("p", { class: "account-error" }, text(this.message))] : []),
    );
  }
}
