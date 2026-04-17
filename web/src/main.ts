import "./style.css";
import processorUrl from "./processor.ts?url";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container '#app' was not found.");
}

app.innerHTML = `
  <main class="layout">
    <section class="panel hero">
      <p class="eyebrow">Stage 1 Playback</p>
      <h1>MKVDRV-Wasm</h1>
      <p class="lead">
        Rust/Wasm で生成したサイン波テーブルを AudioWorklet に渡し、ブラウザ上で実際に音を出す最小構成です。
      </p>
      <div class="actions">
        <button id="start-button" type="button">Start Sine</button>
        <button id="stop-button" type="button">Stop</button>
      </div>
      <label class="control">
        <span>Frequency</span>
        <input id="frequency" type="range" min="110" max="880" step="1" value="440" />
        <strong id="frequency-value">440 Hz</strong>
      </label>
      <pre id="log-output" class="log">Booting MKVDRV-Wasm...</pre>
    </section>

    <section class="panel">
      <h2>Signal Path</h2>
      <ul>
        <li><code>/core</code>: Rust が 1 周期分のサイン波テーブルを生成</li>
        <li><code>/web/src/main.ts</code>: Wasm を読み込み、AudioWorklet を起動</li>
        <li><code>/web/src/processor.ts</code>: テーブル参照で連続再生</li>
      </ul>
    </section>
  </main>
`;

type MkvdrvWasmExports = {
  memory: WebAssembly.Memory;
  mkvdrv_init_message_ptr: () => number;
  mkvdrv_init_message_len: () => number;
  mkvdrv_wavetable_ptr: () => number;
  mkvdrv_fill_sine_wavetable: (requestedLen: number) => number;
};

type WasmRuntime = {
  exports: MkvdrvWasmExports;
  message: string;
  wavetable: Float32Array;
};

let runtimePromise: Promise<WasmRuntime> | undefined;
let audioContext: AudioContext | undefined;
let workletNode: AudioWorkletNode | undefined;

const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-button");
const frequencyInput = document.querySelector<HTMLInputElement>("#frequency");
const frequencyValue = document.querySelector<HTMLElement>("#frequency-value");
const logOutput = document.querySelector<HTMLElement>("#log-output");

const updateLog = (message: string) => {
  if (!logOutput) {
    return;
  }

  logOutput.textContent = message;
};

const readUtf8 = (
  memory: WebAssembly.Memory,
  pointer: number,
  length: number
): string => {
  const bytes = new Uint8Array(memory.buffer, pointer, length);
  return new TextDecoder().decode(bytes);
};

const loadRuntime = async (): Promise<WasmRuntime> => {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const response = await fetch("/wasm/mkvdrv_wasm_core.wasm");
      const { instance } = await WebAssembly.instantiateStreaming(response, {});
      const exports = instance.exports as unknown as MkvdrvWasmExports;

      const message = readUtf8(
        exports.memory,
        exports.mkvdrv_init_message_ptr(),
        exports.mkvdrv_init_message_len()
      );

      const wavetableLength = exports.mkvdrv_fill_sine_wavetable(2048);
      const wavetablePointer = exports.mkvdrv_wavetable_ptr();
      const source = new Float32Array(
        exports.memory.buffer,
        wavetablePointer,
        wavetableLength
      );
      const wavetable = new Float32Array(source);

      return { exports, message, wavetable };
    })();
  }

  return runtimePromise;
};

const currentFrequency = (): number =>
  Number.parseFloat(frequencyInput?.value ?? "440");

const updateFrequencyLabel = () => {
  if (frequencyValue) {
    frequencyValue.textContent = `${currentFrequency().toFixed(0)} Hz`;
  }
};

const ensureAudioNode = async (): Promise<AudioWorkletNode> => {
  if (!audioContext) {
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(processorUrl);
  }

  if (!workletNode) {
    workletNode = new AudioWorkletNode(audioContext, "mkvdrv-processor");
    workletNode.connect(audioContext.destination);

    workletNode.port.onmessage = (event: MessageEvent<string>) => {
      updateLog(event.data);
    };
  }

  return workletNode;
};

const boot = async () => {
  try {
    updateFrequencyLabel();

    const runtime = await loadRuntime();
    updateLog(`${runtime.message}\nWavetable length: ${runtime.wavetable.length} samples`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to boot Wasm runtime.\n${reason}`);
  }
};

startButton?.addEventListener("click", async () => {
  try {
    const runtime = await loadRuntime();
    const node = await ensureAudioNode();

    await audioContext?.resume();

    node.port.postMessage({
      type: "configure",
      wavetable: runtime.wavetable,
      frequency: currentFrequency(),
      sampleRate: audioContext?.sampleRate ?? 48_000
    });
    node.port.postMessage({ type: "start" });

    updateLog(
      `${runtime.message}\nPlayback started at ${currentFrequency().toFixed(0)} Hz`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to start playback.\n${reason}`);
  }
});

stopButton?.addEventListener("click", async () => {
  if (!workletNode) {
    updateLog("Playback is not running.");
    return;
  }

  workletNode.port.postMessage({ type: "stop" });
  await audioContext?.suspend();
  updateLog("Playback stopped.");
});

frequencyInput?.addEventListener("input", () => {
  updateFrequencyLabel();

  workletNode?.port.postMessage({
    type: "setFrequency",
    frequency: currentFrequency()
  });
});

void boot();
