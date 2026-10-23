import type { ScenarioResult } from "./scenario.ts";

declare global {
  interface Window {
    playScenario: (mapUrl: string, ticks: number) => Promise<ScenarioResult>;
  }
}

window.playScenario = async (mapUrl, ticks) => {
  const [bin, json] = await Promise.all([fetch(`${mapUrl}.bin`), fetch(`${mapUrl}.json`)]);
  const bytes = new Uint8Array(await bin.arrayBuffer());
  const manifest: unknown = await json.json();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ScenarioResult>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message));
    };
    worker.postMessage({ bytes, manifest, ticks }, [bytes.buffer]);
  });
};
