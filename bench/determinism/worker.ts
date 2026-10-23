import type { MapDescription } from "@frontfall/engine";
import { playScenario } from "./scenario.ts";

interface Request {
  readonly bytes: Uint8Array;
  readonly manifest: MapDescription;
  readonly ticks: number;
}

// Runs in a browser worker, as the game's simulation does.
self.onmessage = (event: MessageEvent<Request>) => {
  const { bytes, manifest, ticks } = event.data;
  self.postMessage(playScenario(bytes, manifest, ticks));
};
