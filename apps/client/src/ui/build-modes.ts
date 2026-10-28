import { Disable } from "@frontfall/engine";
import type { BuildView, ClickMode } from "../game/solo-game.ts";

/** The build buttons, with their shortcut keys (screen/game-keys.ts), in the order the HUD and the help list them. */
export const BUILD_MODES = [
  { mode: "city", key: "C" },
  { mode: "palace", key: "B" },
  { mode: "fort", key: "F" },
  { mode: "port", key: "O" },
  { mode: "silo", key: "L" },
  { mode: "airDefense", key: "K" },
  { mode: "warship", key: "V" },
  { mode: "missile", key: "M" },
  { mode: "heavyMissile", key: "N" },
  { mode: "demolish", key: "X" },
] as const satisfies readonly { mode: ClickMode; key: string }[];

/** The `Disable` bit that leaves a build mode out of a game (R-MODE-03); missiles go with silos. */
const MODE_BITS: Partial<Record<ClickMode, number>> = {
  city: Disable.City,
  palace: Disable.City,
  fort: Disable.Fort,
  port: Disable.Port,
  silo: Disable.Silo,
  airDefense: Disable.AirDefense,
  warship: Disable.Warships,
  missile: Disable.Silo,
  heavyMissile: Disable.Silo,
};

/** Gold the next one costs the player; none for demolish. */
export function costOf(mode: ClickMode, build: BuildView): number | undefined {
  const costs: Partial<Record<ClickMode, number>> = {
    city: build.cityCost,
    palace: build.palaceCost,
    fort: build.fortCost,
    port: build.portCost,
    silo: build.siloCost,
    airDefense: build.airDefenseCost,
    warship: build.warshipCost,
    missile: build.missileCost,
    heavyMissile: build.heavyMissileCost,
  };
  return costs[mode];
}

/** Whether a game that leaves out `disabled` has this build mode. */
export function offers(mode: ClickMode, disabled: number): boolean {
  return (disabled & (MODE_BITS[mode] ?? 0)) === 0;
}
