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
      <label class="control control-compact">
        <span>Branch Select</span>
        <input id="branch-index" type="number" min="0" max="31" step="1" value="0" />
        <strong id="branch-index-value">branch 0</strong>
      </label>
      <label class="control control-compact">
        <span>Sound Engine</span>
        <select id="render-engine" class="sample-select">
          <option value="an74689">AN74689 PSG</option>
          <option value="sine">Sine Test</option>
        </select>
      </label>
      <label class="control">
        <span>MML Sample</span>
        <select id="mml-sample" class="sample-select">
          <option value="arp">Arpeggio Demo</option>
          <option value="scale">Scale Walk</option>
          <option value="channels">Channel Split</option>
          <option value="noise">Noise Mode</option>
          <option value="envelope">Envelope Shape</option>
          <option value="articulation">Articulation Check</option>
          <option value="branch">Branch Selection</option>
          <option value="error">Error Example</option>
        </select>
      </label>
      <label class="control">
        <span>MML Input</span>
        <div class="mml-editor-shell">
          <pre id="mml-overlay" class="mml-overlay" aria-hidden="true"></pre>
          <textarea id="mml-input" class="mml-editor" spellcheck="false">t124 o4 l16 ceg>c<g e c r dfa>b<a f d r</textarea>
        </div>
      </label>
      <div class="mml-legend" aria-label="MML token legend">
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-note"></i>Note</span>
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-command"></i>Command</span>
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-number"></i>Number</span>
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-operator"></i>Operator</span>
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-bracket"></i>Bracket</span>
        <span class="mml-legend-item"><i class="mml-legend-chip mml-token-comment"></i>Comment</span>
      </div>
      <div id="mml-error" class="mml-error" hidden>
        <strong>MML Error</strong>
        <p id="mml-error-summary" class="mml-error-summary"></p>
        <div id="mml-error-actions" class="mml-error-actions"></div>
        <div id="mml-quick-fix-preview" class="mml-quick-fix-preview" hidden>
          <strong>Quick Fix Preview</strong>
          <p id="mml-quick-fix-label" class="mml-quick-fix-label"></p>
          <p id="mml-quick-fix-meta" class="mml-quick-fix-meta"></p>
          <div id="mml-quick-fix-options" class="mml-quick-fix-options"></div>
          <div class="mml-quick-fix-columns">
            <div class="mml-quick-fix-card">
              <span class="mml-quick-fix-heading">Before</span>
              <pre id="mml-quick-fix-before" class="mml-quick-fix-code"></pre>
            </div>
            <div class="mml-quick-fix-card">
              <span class="mml-quick-fix-heading">After</span>
              <pre id="mml-quick-fix-after" class="mml-quick-fix-code"></pre>
            </div>
          </div>
          <div class="mml-quick-fix-actions">
            <button id="mml-quick-fix-apply" class="mml-error-jump" type="button">
              プレビュー内容を適用
            </button>
            <button id="mml-quick-fix-cancel" class="mml-error-jump" type="button">
              キャンセル
            </button>
          </div>
        </div>
        <pre id="mml-error-context" class="mml-error-context"></pre>
      </div>
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
  mkvdrv_envelope_definition_count: () => number;
  mkvdrv_envelope_definition_headers_ptr: () => number;
  mkvdrv_envelope_definition_values_ptr: () => number;
  mkvdrv_envelope_definition_header_stride: () => number;
  mkvdrv_envelope_definition_value_stride: () => number;
  mkvdrv_fill_demo_sequence: () => number;
  mkvdrv_mml_input_buffer_ptr: () => number;
  mkvdrv_mml_input_buffer_capacity: () => number;
  mkvdrv_set_conditional_branch_index: (branchIndex: number) => void;
  mkvdrv_conditional_branch_index: () => number;
  mkvdrv_last_parse_error_message_ptr: () => number;
  mkvdrv_last_parse_error_message_len: () => number;
  mkvdrv_last_parse_error_position: () => number;
  mkvdrv_parse_diagnostic_count: () => number;
  mkvdrv_parse_diagnostic_positions_ptr: () => number;
  mkvdrv_parse_diagnostic_ends_ptr: () => number;
  mkvdrv_parse_diagnostic_related_positions_ptr: () => number;
  mkvdrv_parse_diagnostic_message_lens_ptr: () => number;
  mkvdrv_parse_diagnostic_quick_fix_counts_ptr: () => number;
  mkvdrv_parse_diagnostic_messages_ptr: () => number;
  mkvdrv_parse_diagnostic_quick_fix_label_lens_ptr: () => number;
  mkvdrv_parse_diagnostic_quick_fix_replacement_lens_ptr: () => number;
  mkvdrv_parse_diagnostic_quick_fix_labels_ptr: () => number;
  mkvdrv_parse_diagnostic_quick_fix_replacements_ptr: () => number;
  mkvdrv_parse_diagnostic_message_stride: () => number;
  mkvdrv_parse_diagnostic_quick_fix_slot_count: () => number;
  mkvdrv_parse_diagnostic_quick_fix_label_stride: () => number;
  mkvdrv_parse_diagnostic_quick_fix_replacement_stride: () => number;
  mkvdrv_parse_mml_from_buffer: (inputLength: number) => number;
};

type RenderEngine = "sine" | "an74689";

type SequenceEnvelope = {
  id: number;
  speed: number;
  values: number[];
  loopStart?: number;
};

type WasmRuntime = {
  exports: MkvdrvWasmExports;
  message: string;
  wavetable: Float32Array;
  noteFrequencies: Float32Array;
  sequenceEvents: Uint32Array;
  sequenceEventStride: number;
  sequenceTicksPerBeat: number;
  envelopes: SequenceEnvelope[];
};

let runtimePromise: Promise<WasmRuntime> | undefined;
let audioContext: AudioContext | undefined;
let workletNode: AudioWorkletNode | undefined;
let activeLineRange = { start: 0, end: 0 };

type QuickFixCandidate = {
  label: string;
  replacement: string;
};

type MmlDiagnostic = {
  start: number;
  end: number;
  message: string;
  source: "parser" | "overlay";
  relatedPosition?: number;
  quickFixes: QuickFixCandidate[];
};

let overlayDiagnostics: MmlDiagnostic[] = [];
let pendingQuickFix:
  | {
      diagnostic: MmlDiagnostic;
      diagnosticIndex: number;
      candidateIndex: number;
      beforeRange: string;
      afterRange: string;
    }
  | undefined;

const MML_SAMPLES = {
  arp: {
    label: "Arpeggio Demo",
    source: "t124 o4 l16 ceg>c<g e c r dfa>b<a f d r",
    branchIndex: 0
  },
  scale: {
    label: "Scale Walk",
    source: "t132 o4 l8 cdefgab>c<bagfedc",
    branchIndex: 0
  },
  channels: {
    label: "Channel Split",
    source: "A t132 o4 l8 c>c<g e\nB o3 l8 c g c g\nC o2 l4 c r\nN l8 c r c r",
    branchIndex: 0
  },
  noise: {
    label: "Noise Mode",
    source: "A t132 o4 l8 c e g e\nN l8 v10 w1 c r c r\nN l8 v10 w0 c r c r",
    branchIndex: 0
  },
  envelope: {
    label: "Envelope Shape",
    source:
      "@E1={1,0,2,4,6,8,10,12,14}\n@E2={2,0,4,8,12,255,1}\nA t132 o4 l8 @E1 v14 c e g > c\nB o3 l8 @E2 v11 c c g g\nN l8 @E2 v9 w1 c r c r",
    branchIndex: 0
  },
  articulation: {
    label: "Articulation Check",
    source: "t120 o4 l8 q3 c d e f Q6 g a b > c R:2 ~b:3",
    branchIndex: 0
  },
  branch: {
    label: "Branch Selection",
    source: "t128 o4 l8 c{d/e/f}g {c/e/g} r",
    branchIndex: 1
  },
  error: {
    label: "Error Example",
    source: "t128 o4 l8 c { d / e / } g",
    branchIndex: 0
  }
} as const;
type SampleKey = keyof typeof MML_SAMPLES;

const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const sequenceButton =
  document.querySelector<HTMLButtonElement>("#sequence-button");
const mmlButton = document.querySelector<HTMLButtonElement>("#mml-button");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-button");
const frequencyInput = document.querySelector<HTMLInputElement>("#frequency");
const frequencyValue = document.querySelector<HTMLElement>("#frequency-value");
const tempoInput = document.querySelector<HTMLInputElement>("#tempo");
const tempoValue = document.querySelector<HTMLElement>("#tempo-value");
const branchIndexInput =
  document.querySelector<HTMLInputElement>("#branch-index");
const branchIndexValue =
  document.querySelector<HTMLElement>("#branch-index-value");
const renderEngineSelect =
  document.querySelector<HTMLSelectElement>("#render-engine");
const sampleSelect = document.querySelector<HTMLSelectElement>("#mml-sample");
const mmlOverlay = document.querySelector<HTMLElement>("#mml-overlay");
const mmlEditorShell =
  document.querySelector<HTMLDivElement>(".mml-editor-shell");
const mmlInput = document.querySelector<HTMLTextAreaElement>("#mml-input");
const mmlError = document.querySelector<HTMLDivElement>("#mml-error");
const mmlErrorSummary =
  document.querySelector<HTMLElement>("#mml-error-summary");
const mmlErrorActions =
  document.querySelector<HTMLDivElement>("#mml-error-actions");
const mmlQuickFixPreview = document.querySelector<HTMLDivElement>(
  "#mml-quick-fix-preview"
);
const mmlQuickFixLabel = document.querySelector<HTMLElement>(
  "#mml-quick-fix-label"
);
const mmlQuickFixMeta = document.querySelector<HTMLElement>(
  "#mml-quick-fix-meta"
);
const mmlQuickFixOptions = document.querySelector<HTMLDivElement>(
  "#mml-quick-fix-options"
);
const mmlQuickFixBefore = document.querySelector<HTMLElement>(
  "#mml-quick-fix-before"
);
const mmlQuickFixAfter = document.querySelector<HTMLElement>(
  "#mml-quick-fix-after"
);
const mmlQuickFixApply = document.querySelector<HTMLButtonElement>(
  "#mml-quick-fix-apply"
);
const mmlQuickFixCancel = document.querySelector<HTMLButtonElement>(
  "#mml-quick-fix-cancel"
);
const mmlErrorContext =
  document.querySelector<HTMLElement>("#mml-error-context");
const logOutput = document.querySelector<HTMLElement>("#log-output");

const updateLog = (message: string) => {
  if (!logOutput) {
    return;
  }

  logOutput.textContent = message;
};

const clearMmlError = () => {
  overlayDiagnostics = [];
  pendingQuickFix = undefined;
  mmlInput?.classList.remove("mml-editor-error");
  mmlEditorShell?.classList.remove("mml-editor-shell-error");

  if (mmlError) {
    mmlError.hidden = true;
  }

  if (mmlErrorSummary) {
    mmlErrorSummary.textContent = "";
  }

  if (mmlErrorContext) {
    mmlErrorContext.textContent = "";
  }

  if (mmlErrorActions) {
    mmlErrorActions.innerHTML = "";
  }

  if (mmlQuickFixPreview) {
    mmlQuickFixPreview.hidden = true;
  }

  if (mmlQuickFixLabel) {
    mmlQuickFixLabel.textContent = "";
  }

  if (mmlQuickFixMeta) {
    mmlQuickFixMeta.textContent = "";
  }

  if (mmlQuickFixBefore) {
    mmlQuickFixBefore.textContent = "";
  }

  if (mmlQuickFixAfter) {
    mmlQuickFixAfter.textContent = "";
  }

  if (mmlQuickFixOptions) {
    mmlQuickFixOptions.innerHTML = "";
  }

  renderMmlOverlay();
};

const updateActiveLineRange = () => {
  if (!mmlInput) {
    return;
  }

  const source = mmlInput.value;
  const caret = mmlInput.selectionStart ?? 0;
  const start = source.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", caret);
  const end = lineEndIndex === -1 ? source.length : lineEndIndex;

  activeLineRange = { start, end };
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
      const envelopes = readEnvelopeDefinitions({
        exports,
        message,
        wavetable,
        noteFrequencies,
        sequenceEvents,
        sequenceEventStride: eventStride,
        sequenceTicksPerBeat,
        envelopes: []
      });

      return {
        exports,
        message,
        wavetable,
        noteFrequencies,
        sequenceEvents,
        sequenceEventStride: eventStride,
        sequenceTicksPerBeat,
        envelopes
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

const currentBranchIndex = (): number => {
  const rawValue = Number.parseInt(branchIndexInput?.value ?? "0", 10);

  if (!Number.isFinite(rawValue) || rawValue < 0) {
    return 0;
  }

  return rawValue;
};

const currentRenderEngine = (): RenderEngine =>
  (renderEngineSelect?.value as RenderEngine | undefined) ?? "an74689";

const updateBranchLabel = () => {
  if (branchIndexValue) {
    branchIndexValue.textContent = `branch ${currentBranchIndex()}`;
  }
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeHtmlAttribute = (value: string): string =>
  escapeHtml(value).replaceAll('"', "&quot;");

const selectedSampleKey = (): SampleKey =>
  (sampleSelect?.value as SampleKey | undefined) ?? "arp";

const updateSampleSelection = (source: string) => {
  if (!sampleSelect) {
    return;
  }

  const matchedKey = (Object.entries(MML_SAMPLES) as Array<
    [SampleKey, (typeof MML_SAMPLES)[SampleKey]]
  >).find(([, sample]) => sample.source === source)?.[0];

  sampleSelect.value = matchedKey ?? "";
};

const tokenizeMmlCharClass = (source: string, index: number): string => {
  const character = source[index];

  if (character === "\n" || character === "\r" || character === "\t" || character === " ") {
    return "mml-token-space";
  }

  if (character === ";") {
    return "mml-token-comment";
  }

  if (character >= "0" && character <= "9") {
    return "mml-token-number";
  }

  if ("cdefgab".includes(character)) {
    return "mml-token-note";
  }

  if ("trlqoCQRT".includes(character)) {
    return "mml-token-command";
  }

  if ("<>^&~:/".includes(character)) {
    return "mml-token-operator";
  }

  if ("[]{}".includes(character)) {
    return "mml-token-bracket";
  }

  if ("|".includes(character)) {
    return "mml-token-bar";
  }

  if (".".includes(character)) {
    return "mml-token-dot";
  }

  return "mml-token-text";
};

const readParseDiagnostics = (runtime: WasmRuntime): MmlDiagnostic[] => {
  const count = runtime.exports.mkvdrv_parse_diagnostic_count();
  if (count === 0) {
    return [];
  }

  const positions = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_positions_ptr(),
    count
  );
  const ends = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_ends_ptr(),
    count
  );
  const relatedPositions = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_related_positions_ptr(),
    count
  );
  const messageLens = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_message_lens_ptr(),
    count
  );
  const quickFixCounts = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_counts_ptr(),
    count
  );
  const quickFixSlotCount = runtime.exports.mkvdrv_parse_diagnostic_quick_fix_slot_count();
  const quickFixLabelLens = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_label_lens_ptr(),
    count * quickFixSlotCount
  );
  const quickFixReplacementLens = new Uint32Array(
    runtime.exports.memory.buffer,
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_replacement_lens_ptr(),
    count * quickFixSlotCount
  );
  const messageStride = runtime.exports.mkvdrv_parse_diagnostic_message_stride();
  const quickFixLabelStride =
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_label_stride();
  const quickFixReplacementStride =
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_replacement_stride();
  const messageBase = runtime.exports.mkvdrv_parse_diagnostic_messages_ptr();
  const quickFixLabelBase = runtime.exports.mkvdrv_parse_diagnostic_quick_fix_labels_ptr();
  const quickFixReplacementBase =
    runtime.exports.mkvdrv_parse_diagnostic_quick_fix_replacements_ptr();

  return Array.from({ length: count }, (_, index) => ({
    start: positions[index],
    end: ends[index],
    relatedPosition:
      relatedPositions[index] === 0xffffffff ? undefined : relatedPositions[index],
    message: readUtf8(
      runtime.exports.memory,
      messageBase + index * messageStride,
      messageLens[index]
    ),
    quickFixes: Array.from(
      { length: Math.min(quickFixCounts[index], quickFixSlotCount) },
      (_, slotIndex) => {
        const flatIndex = index * quickFixSlotCount + slotIndex;
        return {
          label: readUtf8(
            runtime.exports.memory,
            quickFixLabelBase + flatIndex * quickFixLabelStride,
            quickFixLabelLens[flatIndex]
          ),
          replacement: readUtf8(
            runtime.exports.memory,
            quickFixReplacementBase + flatIndex * quickFixReplacementStride,
            quickFixReplacementLens[flatIndex]
          )
        };
      }
    ),
    source: "parser" as const
  }));
};

const renderMmlOverlay = () => {
  if (!mmlOverlay || !mmlInput) {
    return;
  }

  const source = mmlInput.value;
  const htmlParts: string[] = [];
  let insideComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const diagnostics = overlayDiagnostics.filter(
      (diagnostic) => index >= diagnostic.start && index < diagnostic.end
    );
    const relatedDiagnostics = overlayDiagnostics.filter(
      (diagnostic) => diagnostic.relatedPosition === index
    );
    const tokenClass = insideComment
      ? "mml-token-comment"
      : tokenizeMmlCharClass(source, index);
    const classes = [tokenClass];

    if (index >= activeLineRange.start && index < activeLineRange.end) {
      classes.push("mml-line-active");
    }

    if (diagnostics.length > 0) {
      classes.push("mml-overlay-error");
      if (diagnostics.length > 1) {
        classes.push("mml-overlay-error-multi");
      }
    }

    if (relatedDiagnostics.length > 0) {
      classes.push("mml-overlay-related");
    }

    const title =
      diagnostics.length > 0 || relatedDiagnostics.length > 0
        ? ` title="${escapeHtmlAttribute(
            [
              ...diagnostics.map((diagnostic) => diagnostic.message),
              ...relatedDiagnostics.map(
                (diagnostic) => `matching opener for: ${diagnostic.message}`
              )
            ].join(" | ")
          )}"`
        : "";
    const renderedCharacter = character === "\n" ? "\n" : escapeHtml(character);

    htmlParts.push(
      `<span class="${classes.join(" ")}"${title}>${renderedCharacter || " "}</span>`
    );

    if (!insideComment && character === ";") {
      insideComment = true;
    } else if (insideComment && character === "\n") {
      insideComment = false;
    }
  }

  mmlOverlay.innerHTML = `${htmlParts.join("") || " "}\n`;
  mmlOverlay.scrollTop = mmlInput.scrollTop;
  mmlOverlay.scrollLeft = mmlInput.scrollLeft;
};

const byteOffsetToTextIndex = (source: string, byteOffset: number): number => {
  if (byteOffset <= 0) {
    return 0;
  }

  let consumedBytes = 0;

  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    const character = codePoint ? String.fromCodePoint(codePoint) : source[index];
    const byteLength = new TextEncoder().encode(character).length;

    if (consumedBytes + byteLength > byteOffset) {
      return index;
    }

    consumedBytes += byteLength;
    index += character.length;
  }

  return source.length;
};

const locateTextOffset = (source: string, byteOffset: number) => {
  const textIndex = byteOffsetToTextIndex(source, byteOffset);
  const clampedOffset = Math.max(0, Math.min(textIndex, source.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < clampedOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { offset: clampedOffset, line, column };
};

const buildErrorContext = (source: string, index: number) => {
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", index);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const lineText = source.slice(lineStart, lineEnd);
  const column = index - lineStart;
  const markerPadding = " ".repeat(Math.max(0, column));

  return `${lineText}\n${markerPadding}^`;
};

const buildQuickFixPreviewRange = (
  source: string,
  start: number,
  end: number,
  replacement: string
) => {
  const location = locateTextOffset(source, start);
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const linePrefix = source.slice(lineStart, start);
  const lineTarget = source.slice(start, end);
  const lineSuffix = source.slice(end, lineEnd);
  const beforeMarker = `${" ".repeat(linePrefix.length)}${"^".repeat(
    Math.max(1, lineTarget.length)
  )}`;
  const afterMarker = `${" ".repeat(linePrefix.length)}${"^".repeat(
    Math.max(1, replacement.length)
  )}`;
  const lineLabel = `L${location.line} | `;

  return {
    beforeRange:
      `${lineLabel}${linePrefix}[${lineTarget || " "}]\n` +
      `${" ".repeat(lineLabel.length)}${beforeMarker}`,
    afterRange:
      `${lineLabel}${linePrefix}[${replacement}]\n` +
      `${" ".repeat(lineLabel.length)}${afterMarker}`,
    location
  };
};

const hideQuickFixPreview = () => {
  pendingQuickFix = undefined;

  if (mmlQuickFixPreview) {
    mmlQuickFixPreview.hidden = true;
  }

  if (mmlQuickFixLabel) {
    mmlQuickFixLabel.textContent = "";
  }

  if (mmlQuickFixMeta) {
    mmlQuickFixMeta.textContent = "";
  }

  if (mmlQuickFixBefore) {
    mmlQuickFixBefore.textContent = "";
  }

  if (mmlQuickFixAfter) {
    mmlQuickFixAfter.textContent = "";
  }
};

const showQuickFixPreview = (
  diagnostic: MmlDiagnostic,
  diagnosticIndex: number,
  candidateIndex: number,
  source: string
) => {
  const candidate = diagnostic.quickFixes[candidateIndex];
  if (!candidate) {
    return;
  }

  const { beforeRange, afterRange, location } = buildQuickFixPreviewRange(
    source,
    diagnostic.start,
    diagnostic.end,
    candidate.replacement
  );

  pendingQuickFix = {
    diagnostic,
    diagnosticIndex,
    candidateIndex,
    beforeRange,
    afterRange
  };

  if (mmlQuickFixPreview) {
    mmlQuickFixPreview.hidden = false;
  }

  if (mmlQuickFixLabel) {
    mmlQuickFixLabel.textContent = diagnostic.message;
  }

  if (mmlQuickFixMeta) {
    mmlQuickFixMeta.textContent =
      `diagnostic #${diagnosticIndex + 1} at line ${location.line}, column ${location.column} ` +
      `| candidate ${candidateIndex + 1}: ${candidate.label} | [ ] marks replacement range`;
  }

  if (mmlQuickFixOptions) {
    mmlQuickFixOptions.innerHTML = "";
    diagnostic.quickFixes.forEach((entry, entryIndex) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "mml-error-jump";
      if (entryIndex === candidateIndex) {
        optionButton.classList.add("mml-error-jump-active");
      }
      optionButton.textContent = `${entryIndex + 1}. ${entry.label}`;
      optionButton.addEventListener("click", () => {
        showQuickFixPreview(diagnostic, diagnosticIndex, entryIndex, source);
      });
      mmlQuickFixOptions.appendChild(optionButton);
    });
  }

  if (mmlQuickFixBefore) {
    mmlQuickFixBefore.textContent = beforeRange;
  }

  if (mmlQuickFixAfter) {
    mmlQuickFixAfter.textContent = afterRange;
  }
};

const selectDiagnostic = (source: string, diagnostic: MmlDiagnostic) => {
  const location = locateTextOffset(source, diagnostic.start);
  const selectionStart = Math.max(0, Math.min(source.length, diagnostic.start));
  const selectionEnd =
    selectionStart >= source.length
      ? selectionStart
      : Math.max(selectionStart + 1, Math.min(source.length, diagnostic.end));

  if (mmlInput) {
    mmlInput.focus();
    mmlInput.setSelectionRange(selectionStart, selectionEnd);
    mmlInput.classList.add("mml-editor-error");
  }
  mmlEditorShell?.classList.add("mml-editor-shell-error");

  renderMmlOverlay();

  if (mmlError) {
    mmlError.hidden = false;
  }

  if (mmlErrorSummary) {
    const heading =
      overlayDiagnostics.length > 1
        ? `${overlayDiagnostics.length} diagnostics found`
        : "1 diagnostic found";
    const detailLines = overlayDiagnostics.map((entry, diagnosticIndex) => {
      const entryLocation = locateTextOffset(source, entry.start);
      return `${diagnosticIndex + 1}. ${entry.message} at line ${entryLocation.line}, column ${entryLocation.column}`;
    });
    mmlErrorSummary.textContent = `${heading}\n${detailLines.join("\n")}`;
  }

  if (mmlErrorActions) {
    mmlErrorActions.innerHTML = "";

    overlayDiagnostics.forEach((entry, diagnosticIndex) => {
      if (entry.quickFixes.length > 0) {
        const quickFixButton = document.createElement("button");
        quickFixButton.type = "button";
        quickFixButton.className = "mml-error-jump";
        quickFixButton.textContent = `#${diagnosticIndex + 1} の候補をプレビュー`;
        quickFixButton.addEventListener("click", () => {
          showQuickFixPreview(entry, diagnosticIndex, 0, source);
        });
        mmlErrorActions.appendChild(quickFixButton);
      }

      if (entry.relatedPosition === undefined) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "mml-error-jump";
      button.textContent = `#${diagnosticIndex + 1} の開始位置へ移動`;
      button.addEventListener("click", () => {
        selectTextRange(source, entry.relatedPosition ?? entry.start, entry.relatedPosition ?? entry.start);
      });
      mmlErrorActions.appendChild(button);
    });
  }

  if (mmlErrorContext) {
    const contexts = overlayDiagnostics.map((entry, diagnosticIndex) => {
      const entryLocation = locateTextOffset(source, entry.start);
      return `#${diagnosticIndex + 1} line ${entryLocation.line}, column ${entryLocation.column}\n${buildErrorContext(source, entry.start)}`;
    });
    mmlErrorContext.textContent = contexts.join("\n\n");
  }

  return location;
};

const selectTextRange = (source: string, start: number, end: number) => {
  const selectionStart = Math.max(0, Math.min(source.length, start));
  const selectionEnd =
    selectionStart >= source.length
      ? selectionStart
      : Math.max(selectionStart + 1, Math.min(source.length, end + 1));

  if (mmlInput) {
    mmlInput.focus();
    mmlInput.setSelectionRange(selectionStart, selectionEnd);
    mmlInput.classList.add("mml-editor-error");
  }

  updateActiveLineRange();
  renderMmlOverlay();
};

const applyQuickFix = (diagnostic: MmlDiagnostic, candidateIndex: number) => {
  const candidate = diagnostic.quickFixes[candidateIndex];
  if (!mmlInput || !candidate) {
    return;
  }

  const source = mmlInput.value;
  const nextValue =
    source.slice(0, diagnostic.start) +
    candidate.replacement +
    source.slice(diagnostic.end);
  const selectionEnd = diagnostic.start + candidate.replacement.length;

  mmlInput.value = nextValue;
  clearMmlError();
  mmlInput.focus();
  mmlInput.setSelectionRange(diagnostic.start, selectionEnd);
  updateActiveLineRange();
  updateSampleSelection(nextValue);
  renderMmlOverlay();
  updateLog(
    `Quick fix applied.\nSelected candidate: ${candidate.label}\nInserted fragment: ${candidate.replacement}`
  );
};

const confirmQuickFix = () => {
  if (!pendingQuickFix) {
    return;
  }

  applyQuickFix(pendingQuickFix.diagnostic, pendingQuickFix.candidateIndex);
};

const readParseError = (runtime: WasmRuntime) => {
  const pointer = runtime.exports.mkvdrv_last_parse_error_message_ptr();
  const length = runtime.exports.mkvdrv_last_parse_error_message_len();
  const position = runtime.exports.mkvdrv_last_parse_error_position();
  const message =
    length > 0 ? readUtf8(runtime.exports.memory, pointer, length) : "parse error";

  return { message, position };
};

const applySample = (sampleKey: SampleKey) => {
  const sample = MML_SAMPLES[sampleKey];

  if (mmlInput) {
    mmlInput.value = sample.source;
  }

  if (branchIndexInput) {
    branchIndexInput.value = String(sample.branchIndex);
  }

  clearMmlError();
  updateActiveLineRange();
  updateBranchLabel();
  updateSampleSelection(sample.source);
  renderMmlOverlay();
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

const readEnvelopeDefinitions = (runtime: WasmRuntime): SequenceEnvelope[] => {
  const count = runtime.exports.mkvdrv_envelope_definition_count();
  const headerStride = runtime.exports.mkvdrv_envelope_definition_header_stride();
  const valueStride = runtime.exports.mkvdrv_envelope_definition_value_stride();
  const headerPointer = runtime.exports.mkvdrv_envelope_definition_headers_ptr();
  const valuePointer = runtime.exports.mkvdrv_envelope_definition_values_ptr();
  const headerSource = new Uint32Array(
    runtime.exports.memory.buffer,
    headerPointer,
    count * headerStride
  );
  const valueSource = new Uint32Array(
    runtime.exports.memory.buffer,
    valuePointer,
    count * valueStride
  );

  return Array.from({ length: count }, (_, index) => {
    const headerBase = index * headerStride;
    const valueBase = index * valueStride;
    const valueCount = headerSource[headerBase + 2] ?? 0;
    const loopStart = headerSource[headerBase + 3];

    return {
      id: headerSource[headerBase] ?? 0,
      speed: headerSource[headerBase + 1] ?? 1,
      values: Array.from(valueSource.slice(valueBase, valueBase + valueCount)),
      loopStart: loopStart === 0xffffffff ? undefined : loopStart
    };
  });
};

const parseMmlText = (
  runtime: WasmRuntime,
  source: string
): { sequenceEvents: Uint32Array; envelopes: SequenceEnvelope[] } => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(source);
  const capacity = runtime.exports.mkvdrv_mml_input_buffer_capacity();

  clearMmlError();

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

  runtime.exports.mkvdrv_set_conditional_branch_index(currentBranchIndex());
  const eventCount = runtime.exports.mkvdrv_parse_mml_from_buffer(encoded.length);
  if (eventCount === 0) {
    const parseError = readParseError(runtime);
    overlayDiagnostics = readParseDiagnostics(runtime).map((diagnostic) => ({
      ...diagnostic,
      start: locateTextOffset(source, diagnostic.start).offset,
      end: locateTextOffset(source, diagnostic.end).offset,
      relatedPosition:
        diagnostic.relatedPosition === undefined
          ? undefined
          : locateTextOffset(source, diagnostic.relatedPosition).offset
    }));

    if (overlayDiagnostics.length === 0) {
      const locationOffset = locateTextOffset(source, parseError.position).offset;
      overlayDiagnostics = [
        {
          start: locationOffset,
          end: Math.min(source.length, locationOffset + 1),
          message: parseError.message,
          quickFixes: [],
          source: "parser"
        }
      ];
    }

    const location = selectDiagnostic(source, overlayDiagnostics[0]);

    throw new Error(
      `${parseError.message} at offset ${location.offset} (line ${location.line}, column ${location.column})`
    );
  }

  return {
    sequenceEvents: readSequenceEvents(runtime, eventCount),
    envelopes: readEnvelopeDefinitions(runtime)
  };
};

const configureNode = (
  node: AudioWorkletNode,
  runtime: WasmRuntime
) => {
  node.port.postMessage({
    type: "configure",
    renderEngine: currentRenderEngine(),
    wavetable: runtime.wavetable,
    frequency: currentFrequency(),
    noteFrequencies: runtime.noteFrequencies
  });
};

const boot = async () => {
  try {
    updateFrequencyLabel();
    updateTempoLabel();
    updateBranchLabel();
    applySample(selectedSampleKey());
    updateActiveLineRange();

    const runtime = await loadRuntime();
    if (branchIndexInput) {
      branchIndexInput.value = String(runtime.exports.mkvdrv_conditional_branch_index());
      updateBranchLabel();
    }
    updateLog(
      `${runtime.message}\nSound engine: ${currentRenderEngine()}\nWavetable length: ${runtime.wavetable.length} samples\nNote table: ${runtime.noteFrequencies.length} entries\nDemo sequence events: ${runtime.sequenceEvents.length / runtime.sequenceEventStride}\nEnvelope defs: ${runtime.envelopes.length}`
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
      `${runtime.message}\nSound engine: ${currentRenderEngine()}\nTone playback started at ${currentFrequency().toFixed(0)} Hz`
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
      eventStride: runtime.sequenceEventStride,
      envelopes: runtime.envelopes
    });

    updateLog(
      `${runtime.message}\nSound engine: ${currentRenderEngine()}\nRust demo sequence started at ${currentTempo().toFixed(0)} BPM`
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
    const { sequenceEvents, envelopes } = parseMmlText(runtime, source);

    node.port.postMessage({
      type: "startSequence",
      bpm: currentTempo(),
      ticksPerBeat: runtime.sequenceTicksPerBeat,
      sequenceEvents,
      eventStride: runtime.sequenceEventStride,
      envelopes
    });

    updateLog(
      `${runtime.message}\nSound engine: ${currentRenderEngine()}\nParsed MML events: ${sequenceEvents.length / runtime.sequenceEventStride}\nEnvelope defs: ${envelopes.length}\nPlayback started from MML input.`
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

branchIndexInput?.addEventListener("input", () => {
  updateBranchLabel();
});

renderEngineSelect?.addEventListener("change", async () => {
  try {
    const runtime = await loadRuntime();
    const node = await ensureAudioNode();
    configureNode(node, runtime);
    updateLog(
      `${runtime.message}\nSound engine switched to ${currentRenderEngine()}.`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    updateLog(`Failed to switch sound engine.\n${reason}`);
  }
});

mmlQuickFixApply?.addEventListener("click", () => {
  confirmQuickFix();
});

mmlQuickFixCancel?.addEventListener("click", () => {
  hideQuickFixPreview();
});

mmlInput?.addEventListener("input", () => {
  hideQuickFixPreview();
  clearMmlError();
  updateActiveLineRange();
  updateSampleSelection(mmlInput.value);
  renderMmlOverlay();
});

mmlInput?.addEventListener("scroll", () => {
  renderMmlOverlay();
});

mmlInput?.addEventListener("click", () => {
  updateActiveLineRange();
  renderMmlOverlay();
});

mmlInput?.addEventListener("keyup", () => {
  updateActiveLineRange();
  renderMmlOverlay();
});

mmlInput?.addEventListener("select", () => {
  updateActiveLineRange();
  renderMmlOverlay();
});

sampleSelect?.addEventListener("change", () => {
  applySample(selectedSampleKey());
});

void boot();
