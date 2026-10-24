import type { ReplayResult } from "@frontfall/engine";
import type { ScenarioResult } from "./scenario.ts";

declare global {
  interface Window {
    playScenario: (mapUrl: string, ticks: number) => Promise<ScenarioResult>;
    playReplay: (mapUrl: string, report: unknown) => Promise<ReplayResult>;
  }
}

async function inWorker<T>(mapUrl: string, request: Record<string, unknown>): Promise<T> {
  const [bin, json] = await Promise.all([fetch(`${mapUrl}.bin`), fetch(`${mapUrl}.json`)]);
  const bytes = new Uint8Array(await bin.arrayBuffer());
  const manifest: unknown = await json.json();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<T>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message));
    };
    worker.postMessage({ ...request, bytes, manifest }, [bytes.buffer]);
  });
}

window.playScenario = (mapUrl, ticks) => inWorker(mapUrl, { kind: "scenario", ticks });
window.playReplay = (mapUrl, report) => inWorker(mapUrl, { kind: "replay", report });
