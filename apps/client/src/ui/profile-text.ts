import { getLanguage, type Language } from "../i18n/index.ts";

/**
 * The profile panel's texts. They sit here rather than in the catalogues
 * because the panel is loaded when first opened: in the catalogues they
 * would weigh on the first download (bench/client/budget.json).
 */
const TEXTS: Record<Language, Record<string, string>> = {
  en: {
    color: "Your colour",
    colorHint: "In solo games. Online and in team games, the game gives the colours.",
    games: "Last games",
    noGames: "No game finished yet.",
    game: "{map} · {mode} · {outcome} · {minutes} min · {date}",
    storedHere:
      "Your name, colour, last games and achievements stay on this device. Nothing is sent.",
    forget: "Forget my profile and achievements",
    "mode.solo": "Solo",
    "mode.public": "Public",
    "mode.private": "Private",
    "outcome.left": "Left",
    "outcome.closed": "Closed",
    "outcome.disconnected": "Disconnected",
    generatedMap: "Generated map",
  },
  fr: {
    color: "Votre couleur",
    colorHint:
      "Dans les parties solo. En ligne et en équipes, c'est le jeu qui donne les couleurs.",
    games: "Dernières parties",
    noGames: "Aucune partie terminée pour l'instant.",
    game: "{map} · {mode} · {outcome} · {minutes} min · {date}",
    storedHere:
      "Votre nom, votre couleur, vos dernières parties et vos succès restent sur cet appareil. Rien n'est envoyé.",
    forget: "Oublier mon profil et mes succès",
    "mode.solo": "Solo",
    "mode.public": "Publique",
    "mode.private": "Privée",
    "outcome.left": "Quittée",
    "outcome.closed": "Fermée",
    "outcome.disconnected": "Déconnecté",
    generatedMap: "Carte générée",
  },
};

/** A text of the panel in the current language, with `{name}` placeholders filled. */
export function text(key: string, params: Readonly<Record<string, string | number>> = {}): string {
  return (TEXTS[getLanguage()][key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
