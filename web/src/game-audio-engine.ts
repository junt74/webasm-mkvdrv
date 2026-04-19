import type { ExportedSong, RenderEngine } from "./song-format";
import { sequencePayloadFromSong } from "./song-format";

type WorkletConfigureMessage = {
  type: "configure";
  renderEngine: RenderEngine;
  wavetable: Float32Array;
  frequency: number;
  noteFrequencies: Float32Array;
};

type WorkletStartSequenceMessage = ReturnType<typeof sequencePayloadFromSong> & {
  type: "startSequence";
};

/** Emitted next to this bundle by `build:engine` (esbuild of `processor.ts`). */
const processorModuleHref = new URL(
  /* @vite-ignore */
  "./mkvdrv-processor.worklet.js",
  import.meta.url
).href;

export class MkvdrvGameAudioEngine {
  private audioContext?: AudioContext;
  private workletNode?: AudioWorkletNode;
  private currentSong?: ExportedSong;
  private renderEngine: RenderEngine = "an74689";
  private masterVolume = 1;
  private readonly wavetable: Float32Array;
  private readonly noteFrequencies: Float32Array;
  private readonly initialFrequency: number;

  constructor(options?: {
    initialFrequency?: number;
    wavetableSize?: number;
  }) {
    this.initialFrequency = options?.initialFrequency ?? 440;
    this.wavetable = createSineWavetable(options?.wavetableSize ?? 2048);
    this.noteFrequencies = createNoteFrequencyTable();
  }

  async initialize(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      await this.audioContext.audioWorklet.addModule(processorModuleHref);
    }

    if (!this.workletNode) {
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "mkvdrv-processor"
      );
      this.workletNode.connect(this.audioContext.destination);
      this.workletNode.port.postMessage(this.buildConfigureMessage());
      this.workletNode.port.postMessage({
        type: "setMasterVolume",
        volume: this.masterVolume
      });
    }
  }

  async loadSong(song: ExportedSong): Promise<void> {
    await this.initialize();
    this.currentSong = song;
  }

  async loadSongFromUrl(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load song JSON: ${response.status} ${response.statusText}`);
    }

    const song = (await response.json()) as ExportedSong;
    await this.loadSong(song);
  }

  async play(): Promise<void> {
    if (!this.currentSong) {
      throw new Error("No song has been loaded.");
    }

    await this.initialize();
    await this.audioContext?.resume();
    this.workletNode?.port.postMessage({
      type: "startSequence",
      ...sequencePayloadFromSong(this.currentSong)
    } satisfies WorkletStartSequenceMessage);
  }

  async stop(): Promise<void> {
    this.workletNode?.port.postMessage({ type: "stop" });
    await this.audioContext?.suspend();
  }

  async pause(): Promise<void> {
    await this.audioContext?.suspend();
  }

  async resume(): Promise<void> {
    await this.audioContext?.resume();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.workletNode?.port.postMessage({
      type: "setMasterVolume",
      volume: this.masterVolume
    });
  }

  setRenderEngine(renderEngine: RenderEngine): void {
    this.renderEngine = renderEngine;
    this.workletNode?.port.postMessage(this.buildConfigureMessage());
  }

  private buildConfigureMessage(): WorkletConfigureMessage {
    return {
      type: "configure",
      renderEngine: this.renderEngine,
      wavetable: this.wavetable,
      frequency: this.initialFrequency,
      noteFrequencies: this.noteFrequencies
    };
  }
}

const createSineWavetable = (size: number): Float32Array => {
  const length = Math.max(32, size | 0);
  const wavetable = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    wavetable[index] = Math.sin((index / length) * Math.PI * 2);
  }

  return wavetable;
};

const createNoteFrequencyTable = (): Float32Array => {
  const noteFrequencies = new Float32Array(128);

  for (let note = 0; note < noteFrequencies.length; note += 1) {
    noteFrequencies[note] = 440 * 2 ** ((note - 69) / 12);
  }

  return noteFrequencies;
};
