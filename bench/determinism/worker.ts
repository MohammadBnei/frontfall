import {
  DEFAULT_BALANCE,
  loadMap,
  readDesyncReport,
  replayDesyncReport,
  type MapDescription,
} from "@frontfall/engine";
import { playScenario } from "./scenario.ts";

type Request =
  | {
      readonly kind: "scenario";
      readonly bytes: Uint8Array;
      readonly manifest: MapDescription;
      readonly ticks: number;
    }
  | {
      readonly kind: "replay";
      readonly bytes: Uint8Array;
      readonly manifest: MapDescription;
      readonly report: unknown;
    };

// Runs in a browser worker, as the game's simulation does.
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.kind === "scenario") {
    self.postMessage(playScenario(request.bytes, request.manifest, request.ticks));
    return;
  }
  // Golden replays are played with today's balance, as in the Node test.
  const report = readDesyncReport(request.report);
  const { terrain } = loadMap(request.bytes, request.manifest);
  self.postMessage(replayDesyncReport({ ...report, balance: DEFAULT_BALANCE }, terrain));
};
