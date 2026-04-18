import "./style.css";
import processorUrl from "./processor.ts?url";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container '#app' was not found.");
}

app.innerHTML = `
  <main class="layout">
    <section class="panel hero">
      <p class="eyebrow">Stage 1 Sequencing</p>
      <h1>MKVDRV-Wasm</h1>
      <p class="lead">
        Rust/Wasm で波形テーブルとノート周波数テーブルを生成し、AudioWorklet 側で単音再生と簡易シーケンスを処理する最小構成です。
      </p>
      <div class="actions">
        <button id="start-button" type="button">Start Tone</button>
        <button id="sequence-button" type="button">Start Demo</button>
        <button id="mml-button" type="button">Play MML</button>
        <button id="stop-button" type="button">Stop</button>
      </div>
      <label class="control">
        <span>Frequency</span>
        <input id="frequency" type="range" min="110" max="880" step="1" value="440" />
        <strong id="frequency-value">440 Hz</strong>
      </label>
      <label class="control">
        <span>Tempo</span>
        <input id="tempo" type="range" min="80" max="180" step="1" value="124" />
        <strong id="tempo-value">124 BPM</strong>
      </label>
      <label class="control">
        <span>MML Input</span>
        <textarea id="mml-input" class="mml-editor" spellcheck="false">t124 o4 l16 ceg>c<g e c r dfa>b<a f d r</textarea>
      </label>
      <pre id="log-output" class="log">Booting MKVDRV-Wasm...</pre>
    </section>

    <section class="panel">
      <h2>Signal Path</h2>
      <ul>
        <li><code>/core</code>: Rust がサイン波テーブルと MIDI ノート周波数表を生成</li>
        <li><code>/web/src/main.ts</code>: Wasm を読み込み、MML を入力バッファへ転送する</li>
        <li><code>/web/src/processor.ts</code>: 単音再生とイベント列シーケンサを実行</li>
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
  mkvdrv_note_frequencies_ptr: () => number;
  mkvdrv_fill_note_frequencies: () => number;
  mkvdrv_sequence_events_ptr: () => number;
  mkvdrv_sequence_event_stride: () => number;
  mkvdrv_sequence_ticks_per_beat: () => number;
  mkvdrv_fill_demo_sequence: () => number;
  mkvdrv_mml_input_buffer_ptr: () => number;
  mkvdrv_mml_input_buffer_capacity: () => number;
  mkvdrv_parse_mml_from_buffer: (inputLength: number) => number;
};

type WasmRuntime = {
  exports: MkvdrvWasmExports;
  message: string;
  wavetable: Float32Array;
  noteFrequencies: Float32Array;
  sequenceEvents: Uint32Array;
  sequenceEventStride: number;
  sequenceTicksPerBeat: number;
};

let runtimePromise: Promise<WasmRuntime> | undefined;
let audioContext: AudioContext | undefined;
let workletNode: AudioWorkletNode | undefined;

const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const sequenceButton =
  document.querySelector<HTMLButtonElement>("#sequence-button");
const mmlButton = document.querySelector<HTMLButtonElement>("#mml-button");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-button");
const frequencyInput = document.querySelector<HTMLInputElement>("#frequency");
const frequencyValue = document.querySelector<HTMLElement>("#frequency-value");
const tempoInput = document.querySelector<HTMLInputElement>("#tempo");
const tempoValue = document.querySelector<HTMLElement>("#tempo-value");
const mmlInput = document.querySelector<HTMLTextAreaElement>("#mml-input");
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

      const noteTableLength = exports.mkvdrv_fill_note_frequencies();
      const noteTablePointer = exports.mkvdrv_note_frequencies_ptr();
      const noteSource = new Float32Array(
        exports.memory.buffer,
        noteTablePointer,
        noteTableLength
      );
      const noteFrequencies = new Float32Array(noteSource);
      const eventCount = exports.mkvdrv_fill_demo_sequence();
      const eventStride = exports.mkvdrv_sequence_event_stride();
      const eventPointer = exports.mkvdrv_sequence_events_ptr();
      const eventSource = new Uint32Array(
        exports.memory.buffer,
        eventPointer,
        eventCount * eventStride
      );
      const sequenceEvents = new Uint32Array(eventSource);
      const sequenceTicksPerBeat = exports.mkvdrv_sequence_ticks_per_beat();

      return {
        exports,
        message,
        wavetable,
        noteFrequencies,
        sequenceEvents,
        sequenceEventStride: eventStride,
        sequenceTicksPerBeat
      };
    })();
  }

  return runtimePromise;
};

const currentFrequency = (): number =>
  Number.parseFloat(frequencyInput?.value ?? "440");

const currentTempo = (): number =>
  Number.parseFloat(tempoInput?.value ?? "124");

const updateFrequencyLabel = () => {
  if (frequencyValue) {
    frequencyValue.textContent = `${currentFrequency().toFixed(0)} Hz`;
  }
};

const updateTempoLabel = () => {
  if (tempoValue) {
    tempoValue.textContent = `${currentTempo().toFixed(0)} BPM`;
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

const readSequenceEvents = (
  runtime: WasmRuntime,
  eventCount: number
): Uint32Array => {
  const eventPointer = runtime.exports.mkvdrv_sequence_events_ptr();
  const eventSource = new Uint32Array(
    runtime.exports.memory.buffer,
    eventPointer,
    eventCount * runtime.sequenceEventStride
  );

  return new Uint32Array(eventSource);
};

const parseMmlText = (runtime: WasmRuntime, source: string): Uint32Array => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(source);
  const capacity = runtime.exports.mkvdrv_mml_input_buffer_capacity();

  if (encoded.length > capacity) {
    throw new Error(`MML input exceeds buffer capacity (${capacity} bytes).`);
  }

  const bufferPointer = runtime.exports.mkvdrv_mml_input_buffer_ptr();
  const buffer = new Uint8Array(
    runtime.exports.memory.buffer,
    bufferPointer,
    capacity
  );
  buffer.fill(0);
  buffer.set(encoded);

  const eventCount = runtime.exports.mkvdrv_parse_mml_from_buffer(encoded.length);
  if (eventCount === 0) {
    throw new Error("Rust parser returned no events. MML を確認してください。");
  }

  return readSequenceEvents(runtime, eventCount);
};

const configureNode = (
  node: AudioWorkletNode,
  runtime: WasmRuntime
) => {
  node.port.postMessage({
    type: "configure",
    wavetable: runtime.wavetable,
    frequency: currentFrequency(),
    noteFrequencies: runtime.noteFrequencies
  });
};

const boot = async () => {
  try {
    updateFrequencyLabel();
    updateTempoLabel();

    const runtime = await loadRuntime();
    updateLog(
      `${runtime.message}\nWavetable length: ${runtime.wavetable.length} samples\nNote table: ${runtime.noteFrequencies.length} entries\nDemo sequence events: ${runtime.sequenceEvents.length / runtime.sequenceEventStride}`
    );
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

    configureNode(node, runtime);
    node.port.postMessage({ type: "startTone" });

    updateLog(
      `${runtime.message}\nTone playback started at ${currentFrequency().toFixed(0)} Hz`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to start tone playback.\n${reason}`);
  }
});

sequenceButton?.addEventListener("click", async () => {
  try {
    const runtime = await loadRuntime();
    const node = await ensureAudioNode();

    await audioContext?.resume();

    configureNode(node, runtime);
    node.port.postMessage({
      type: "startSequence",
      bpm: currentTempo(),
      ticksPerBeat: runtime.sequenceTicksPerBeat,
      sequenceEvents: runtime.sequenceEvents,
      eventStride: runtime.sequenceEventStride
    });

    updateLog(
      `${runtime.message}\nRust demo sequence started at ${currentTempo().toFixed(0)} BPM`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to start Rust sequence.\n${reason}`);
  }
});

mmlButton?.addEventListener("click", async () => {
  try {
    const runtime = await loadRuntime();
    const node = await ensureAudioNode();

    await audioContext?.resume();

    configureNode(node, runtime);
    const source = mmlInput?.value ?? "";
    const sequenceEvents = parseMmlText(runtime, source);

    node.port.postMessage({
      type: "startSequence",
      bpm: currentTempo(),
      ticksPerBeat: runtime.sequenceTicksPerBeat,
      sequenceEvents,
      eventStride: runtime.sequenceEventStride
    });

    updateLog(
      `${runtime.message}\nParsed MML events: ${sequenceEvents.length / runtime.sequenceEventStride}\nPlayback started from MML input.`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to parse or play MML.\n${reason}`);
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

tempoInput?.addEventListener("input", () => {
  updateTempoLabel();

  workletNode?.port.postMessage({
    type: "setTempo",
    bpm: currentTempo()
  });
});

void boot();
