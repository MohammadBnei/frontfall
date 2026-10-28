import { getLanguage, type Language } from "../i18n/index.ts";

/**
 * Texts of the work share and the attack preview (R-ECO-07). They sit here
 * rather than in the catalogues because the HUD is loaded when a game starts:
 * in the catalogues they would weigh on the first download
 * (bench/client/budget.json).
 */
const TEXTS: Record<Language, Record<string, string>> = {
  en: {
    work: "Workers",
    workHint:
      "Share of your troops at home who work. A worker earns {factor} times the gold of a soldier, but workers neither attack nor defend: your land is cheaper to take.",
    goldRate: "+{rate}/s",
    goldRateHint: "Gold your troops earn each second; trade comes on top.",
    previewTiles: "≈ {count} tiles",
    previewTile: "≈ {count} tile",
    previewSend: "{troops} soldiers, {cost} a tile",
    previewGain: "+{cap} troops of room",
    previewShort: "too few soldiers",
    previewAll: "all of their land",
  },
  fr: {
    work: "Ouvriers",
    workHint:
      "Part de vos troupes à la maison qui travaillent. Un ouvrier rapporte {factor} fois l'or d'un soldat, mais les ouvriers n'attaquent ni ne défendent : vos terres coûtent moins cher à prendre.",
    goldRate: "+{rate}/s",
    goldRateHint: "L'or que vos troupes rapportent chaque seconde, commerce en plus.",
    previewTiles: "≈ {count} cases",
    previewTile: "≈ {count} case",
    previewSend: "{troops} soldats, {cost} par case",
    previewGain: "+{cap} de plafond",
    previewShort: "trop peu de soldats",
    previewAll: "toutes ses terres",
  },
};

/** A text of the work share or the preview in the current language, with `{name}` placeholders filled. */
export function workText(
  key: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return (TEXTS[getLanguage()][key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
