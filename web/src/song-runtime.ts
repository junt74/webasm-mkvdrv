import type {
  RenderEngine,
  SoundChipModel,
  SequenceEnvelope,
  SequencePitchEnvelope,
  SequencePayload
} from "./song-format";
import { getPsgChipCore } from "./chips";
import type { PsgNoiseFrequencyMode } from "./chips/psg-types";
import {
  createAy38910RegisterState,
  resolveAy38910ChannelGain,
  resolveAy38910NoiseEnabled,
  resolveAy38910ToneEnabled,
  writeAy38910ChannelVolume,
  writeAy38910EnvelopePeriod,
  writeAy38910EnvelopeShape,
  writeAy38910MixerNoiseMask,
  writeAy38910MixerToneMask,
  writeAy38910NoisePeriod,
  writeAy38910TonePeriod,
  type Ay38910RegisterState
} from "./chips/ay38910-core";
import {
  decomposeSn76489TonePeriodWrite,
  decomposeSn76489VolumeWrite,
  createSn76489RegisterState,
  decomposeSn76489NoiseControlWriteStep,
  resetSn76489Lfsr,
  resolveSn76489NoiseState,
  shiftSn76489Lfsr,
  writeSn76489NoiseControl,
  writeSn76489TonePeriod,
  writeSn76489Volume,
  type Sn76489RegisterState
} from "./chips/sn76489-core";

type PlaybackMode = "idle" | "tone" | "sequence";

type ToneChannelState = {
  phase: number;
  clockAccumulator: number;
  counter: number;
  output: number;
  frequency: number;
  baseFrequency: number;
  tonePeriod: number;
  baseTonePeriod: number;
  volumeRegister: number;
  amplitude: number;
  targetAmplitude: number;
  baseAmplitude: number;
  panMask: number;
  envelopeId: number;
  pitchEnvelopeId: number;
  pitchOffset: number;
  pitchDelayCounter: number;
  pitchSpeedCounter: number;
  pitchActive: boolean;
  envelopeGain: number;
  envelopeStepIndex: number;
  envelopeSpeedCounter: number;
  envelopeActive: boolean;
  ayHardwareEnvelopeEnabled: boolean;
};

type NoiseChannelState = {
  phase: number;
  clockAccumulator: number;
  counter: number;
  shiftClockOutput: number;
  frequency: number;
  baseFrequency: number;
  noisePeriod: number;
  baseNoisePeriod: number;
  frequencyMode: PsgNoiseFrequencyMode;
  volumeRegister: number;
  noiseControlRegister: number;
  amplitude: number;
  targetAmplitude: number;
  lfsr: number;
  output: number;
  mode: number;
  baseAmplitude: number;
  panMask: number;
  envelopeId: number;
  pitchEnvelopeId: number;
  pitchOffset: number;
  pitchDelayCounter: number;
  pitchSpeedCounter: number;
  pitchActive: boolean;
  envelopeGain: number;
  envelopeStepIndex: number;
  envelopeSpeedCounter: number;
  envelopeActive: boolean;
  lastResetReason: "none" | "mode" | "source" | "mode+source";
  ayHardwareEnvelopeEnabled: boolean;
};

type TerminalAction = "none" | "stop" | "wrap";
type AyHardwareEnvelopeState = {
  shape: number;
  period: number;
  clockAccumulator: number;
  counter: number;
  step: number;
  direction: 1 | -1;
  hold: boolean;
  alternate: boolean;
  continueFlag: boolean;
  holding: boolean;
  gain: number;
};
type AyHardwareEnvelopeShapeFlags = {
  continueFlag: boolean;
  attack: boolean;
  alternate: boolean;
  hold: boolean;
};
type AyHardwareEnvelopeCycleResolution = {
  step: number;
  direction: 1 | -1;
  holding: boolean;
};

const PRESET_ENVELOPE_ID_BASE = 0x8000;
const AY_MASTER_CLOCK_HZ = 1_789_773;
const AY_HARDWARE_ENVELOPE_DIVIDER = 256;

const AY_PRESET_ENVELOPES: Record<number, SequenceEnvelope> = {
  0x8001: { id: 0x8001, speed: 1, values: [1] },
  0x8002: { id: 0x8002, speed: 1, values: [5] },
  0x8003: { id: 0x8003, speed: 1, values: [13, 9, 5, 1] },
  0x8004: { id: 0x8004, speed: 2, values: [15, 13, 11, 9, 7, 5, 3, 1] },
  0x8005: { id: 0x8005, speed: 1, values: [1, 5, 9, 12, 15] },
  0x8006: { id: 0x8006, speed: 2, values: [1, 3, 5, 7, 9, 11, 13, 14, 15] },
  0x8007: { id: 0x8007, speed: 1, values: [1, 4, 7, 9, 9, 9, 9] },
  0x8008: { id: 0x8008, speed: 1, values: [1, 9, 1] },
  0x8009: { id: 0x8009, speed: 1, values: [1, 11, 5, 1] }
};

function isPresetEnvelopeId(envelopeId: number): boolean {
  return envelopeId > PRESET_ENVELOPE_ID_BASE && envelopeId < PRESET_ENVELOPE_ID_BASE + 10;
}

function envelopeMapForChipModel(
  chipModel: SoundChipModel,
  envelopes: SequenceEnvelope[]
): Map<number, SequenceEnvelope> {
  const map = new Map(envelopes.map((envelope) => [envelope.id, envelope]));

  if (chipModel !== "ay38910") {
    return map;
  }

  for (const [id, envelope] of Object.entries(AY_PRESET_ENVELOPES)) {
    map.set(Number(id), envelope);
  }

  return map;
}

function parseAyHardwareEnvelopeShape(shape: number): AyHardwareEnvelopeShapeFlags {
  const normalized = Math.max(0, Math.min(15, Math.round(shape))) & 0x0f;
  return {
    continueFlag: (normalized & 0x08) !== 0,
    attack: (normalized & 0x04) !== 0,
    alternate: (normalized & 0x02) !== 0,
    hold: (normalized & 0x01) !== 0
  };
}

function resolveAyHardwareEnvelopeCycleEnd(
  state: Pick<
    AyHardwareEnvelopeState,
    "step" | "direction" | "continueFlag" | "alternate" | "hold"
  >
): AyHardwareEnvelopeCycleResolution {
  if (!state.continueFlag) {
    return {
      step: 0,
      direction: state.direction,
      holding: true
    };
  }

  const nextDirection =
    state.alternate ? (state.direction === 1 ? -1 : 1) : state.direction;

  if (state.hold) {
    return {
      step: nextDirection === 1 ? 15 : 0,
      direction: nextDirection,
      holding: true
    };
  }

  return {
    step: nextDirection === 1 ? 0 : 15,
    direction: nextDirection,
    holding: false
  };
}

function traceAyHardwareEnvelopeSteps(shape: number, stepsToCollect = 20): number[] {
  const flags = parseAyHardwareEnvelopeShape(shape);
  let step = flags.attack ? 0 : 15;
  let direction: 1 | -1 = flags.attack ? 1 : -1;
  let holding = false;
  const trace = [step];

  while (trace.length < stepsToCollect) {
    if (holding) {
      trace.push(step);
      continue;
    }

    const nextStep = step + direction;
    if (nextStep >= 0 && nextStep <= 15) {
      step = nextStep;
      trace.push(step);
      continue;
    }

    const resolution = resolveAyHardwareEnvelopeCycleEnd({
      step,
      direction,
      continueFlag: flags.continueFlag,
      alternate: flags.alternate,
      hold: flags.hold
    });
    step = resolution.step;
    direction = resolution.direction;
    holding = resolution.holding;
    trace.push(step);
  }

  return trace;
}

export class MkvdrvSongRuntime {
  static readonly EVENT_NOTE_ON = 1;
  static readonly EVENT_NOTE_OFF = 2;
  static readonly EVENT_TEMPO = 3;
  static readonly EVENT_VOLUME = 4;
  static readonly EVENT_NOISE_ON = 5;
  static readonly EVENT_NOISE_OFF = 6;
  static readonly EVENT_ENVELOPE_SELECT = 7;
  static readonly EVENT_PAN = 8;
  static readonly EVENT_PITCH_ENVELOPE_SELECT = 9;
  static readonly EVENT_AY_HARDWARE_ENVELOPE_SHAPE = 10;
  static readonly EVENT_AY_HARDWARE_ENVELOPE_PERIOD = 11;
  static readonly EVENT_AY_HARDWARE_ENVELOPE_ENABLE = 12;
  static readonly EVENT_AY_MIXER_TONE_MASK = 13;
  static readonly EVENT_AY_MIXER_NOISE_MASK = 14;
  static readonly PSG_TONE_CHANNELS = 3;
  static readonly PSG_NOISE_CHANNEL = 3;
  static readonly PSG_NOISE_MODE_PERIODIC = 0;
  static readonly PSG_NOISE_MODE_WHITE = 1;
  static readonly PSG_PAN_RIGHT = 1;
  static readonly PSG_PAN_LEFT = 2;
  static readonly PSG_PAN_BOTH = 3;

  private wavetable = new Float32Array([0]);
  private noteFrequencies = new Float32Array(128);
  private renderEngine: RenderEngine = "psg";
  private chipModel: SoundChipModel = "sn76489";
  private sequenceEvents = new Uint32Array(0);
  private eventStride = 5;
  private previewFrequency = 440;
  private mode: PlaybackMode = "idle";
  private attackRate = 0.0035;
  private releaseRate = 0.0018;
  private bpm = 124;
  private ticksPerBeat = 96;
  private loopCount = 0;
  private loopsRemaining = 0;
  private tailTicks = 0;
  private sequenceIndex = 0;
  private pendingTerminalAction: TerminalAction = "none";
  private eventSamplesRemaining = 0;
  private samplesPerTick: number;
  private tickSamplesRemaining: number;
  private masterVolume = 1;
  private envelopes = new Map<number, SequenceEnvelope>();
  private pitchEnvelopes = new Map<number, SequencePitchEnvelope>();
  private toneChannels: ToneChannelState[] = [];
  private noiseChannel: NoiseChannelState;
  private ayHardwareEnvelope: AyHardwareEnvelopeState;
  private ay38910Registers: Ay38910RegisterState = createAy38910RegisterState();
  private sn76489Registers: Sn76489RegisterState = createSn76489RegisterState();

  constructor(private readonly sampleRateValue: number) {
    this.samplesPerTick = sampleRateValue / 192;
    this.tickSamplesRemaining = this.samplesPerTick;
    this.noiseChannel = this.createNoiseChannel();
    this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
    this.resetChannels();
  }

  private get chipCore() {
    return getPsgChipCore(this.chipModel);
  }

  configure({
    renderEngine,
    chipModel,
    wavetable,
    noteFrequencies,
    frequency
  }: {
    renderEngine: RenderEngine;
    chipModel: SoundChipModel;
    wavetable: Float32Array;
    noteFrequencies: Float32Array;
    frequency: number;
  }): string {
    this.renderEngine = renderEngine;
    this.chipModel = chipModel;
    this.wavetable = new Float32Array(wavetable);
    this.noteFrequencies = new Float32Array(noteFrequencies);
    this.previewFrequency = frequency;
    this.resetChannels();
    this.configureTonePreviewVoices(frequency);

    return `AudioWorklet ready.\nRenderer: ${this.renderEngine}\nChip: ${this.chipModel}\nFrequency: ${this.previewFrequency.toFixed(0)} Hz`;
  }

  startTone(): void {
    this.mode = "tone";
    this.configureTonePreviewVoices(this.previewFrequency);
  }

  loadSequence(payload: SequencePayload): string {
    this.mode = "sequence";
    this.chipModel = payload.chipModel;
    this.bpm = payload.bpm;
    this.ticksPerBeat = payload.ticksPerBeat;
    this.loopCount = payload.loopCount;
    this.loopsRemaining = this.loopCount < 0 ? -1 : Math.max(0, this.loopCount);
    this.tailTicks = payload.tailTicks;
    this.samplesPerTick = (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue;
    this.tickSamplesRemaining = this.samplesPerTick;
    this.sequenceEvents = new Uint32Array(payload.sequenceEvents);
    this.eventStride = payload.eventStride;
    this.envelopes = envelopeMapForChipModel(this.chipModel, payload.envelopes);
    this.pitchEnvelopes = new Map(
      payload.pitchEnvelopes.map((envelope) => [envelope.id, envelope])
    );
    this.sequenceIndex = 0;
    this.eventSamplesRemaining = 0;
    this.pendingTerminalAction = "none";
    this.resetChannels();
    this.advanceSequenceEvent();

    const ayDebug = this.describeAyHardwareEnvelopeDebug();
    const snDebug = this.describeSn76489WriteTrace();

    return `Sequence ready.\nChip: ${this.chipModel}\nTempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}, loop: ${this.loopCount}${ayDebug}${snDebug}`;
  }

  stop(): void {
    this.mode = "idle";
    this.silenceAllChannels();
  }

  setFrequency(frequency: number): string | undefined {
    this.previewFrequency = frequency;

    if (this.mode === "tone") {
      this.configureTonePreviewVoices(frequency);
      return `Tone frequency: ${this.previewFrequency.toFixed(0)} Hz`;
    }

    return undefined;
  }

  setTempo(bpm: number): string | undefined {
    this.bpm = bpm;
    this.samplesPerTick = (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue;

    if (this.mode === "sequence") {
      return `Sequence tempo: ${this.bpm.toFixed(0)} BPM`;
    }

    return undefined;
  }

  setMasterVolume(volume: number): string {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    return `Master volume: ${(this.masterVolume * 100).toFixed(0)}%`;
  }

  private describeAyHardwareEnvelopeDebug(): string {
    if (this.chipModel !== "ay38910") {
      return "";
    }

    const summaries: string[] = [];
    let currentPeriod = this.ayHardwareEnvelope.period;

    for (let index = 0; index < this.sequenceEvents.length; index += this.eventStride) {
      const kind = this.sequenceEvents[index];
      const value = this.sequenceEvents[index + 1] ?? 0;

      if (kind === MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_PERIOD) {
        currentPeriod = value;
        continue;
      }

      if (kind !== MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_SHAPE) {
        continue;
      }

      const shape = value & 0x0f;
      const trace = traceAyHardwareEnvelopeSteps(shape, 12).join(",");
      const summary = `EH${shape}@EP${currentPeriod}: ${trace}`;
      if (!summaries.includes(summary)) {
        summaries.push(summary);
      }
      if (summaries.length >= 6) {
        break;
      }
    }

    if (summaries.length === 0) {
      return "";
    }

    return `\nAY HW trace:\n${summaries.join("\n")}`;
  }

  private describeSn76489WriteTrace(): string {
    if (this.chipModel !== "sn76489" || this.sequenceEvents.length === 0) {
      return "";
    }

    let traceState = createSn76489RegisterState();
    const lines: string[] = [];
    const pushTraceLine = (
      eventIndex: number,
      target: string,
      updateKind: "direct" | "derived",
      resetReason: "none" | "mode" | "source" | "mode+source",
      write: string,
      detail = ""
    ) => {
      lines.push(
        `#${eventIndex} | ${target} | kind=${updateKind} | reset=${resetReason} | write=${write} | detail=${detail}`
      );
    };

    for (
      let eventIndex = 0;
      eventIndex < this.sequenceEvents.length / this.eventStride;
      eventIndex += 1
    ) {
      const base = eventIndex * this.eventStride;
      const eventKind = this.sequenceEvents[base];
      const value = this.sequenceEvents[base + 1] ?? 0;
      const channel = this.sequenceEvents[base + 3] ?? 0;
      const param = this.sequenceEvents[base + 4] ?? 0;
      const noiseSettings = this.decodeNoiseParam(param);

      if (eventKind === MkvdrvSongRuntime.EVENT_NOTE_ON && channel < 3) {
        const frequency = this.noteFrequencies[value] ?? 0;
        const period = this.chipCore.tonePeriodFromFrequency(frequency);
        const [latchStep, dataStep] = decomposeSn76489TonePeriodWrite(
          channel as 0 | 1 | 2,
          period
        );
        const [volumeStep] = decomposeSn76489VolumeWrite(
          channel as 0 | 1 | 2,
          param
        );
        traceState = writeSn76489TonePeriod(
          traceState,
          channel as 0 | 1 | 2,
          period
        );
        traceState = writeSn76489Volume(
          traceState,
          channel as 0 | 1 | 2,
          param
        );
        pushTraceLine(
          eventIndex,
          `tone${channel}`,
          "direct",
          "none",
          `R${latchStep.register} latch=${latchStep.value.toString(
            16
          )} data=${dataStep.value.toString(16)}`,
          `R${volumeStep.register}=${volumeStep.value.toString(16)}`
        );

        if (channel === 2 && traceState.noiseSource === "tone2") {
          pushTraceLine(
            eventIndex,
            "noise",
            "derived",
            "none",
            `tone2 follow -> period=${period.toString(16)}`,
            "noise source=tone2"
          );
        }
        continue;
      }

      if (eventKind === MkvdrvSongRuntime.EVENT_VOLUME && channel < 3) {
        const [volumeStep] = decomposeSn76489VolumeWrite(
          channel as 0 | 1 | 2,
          value
        );
        traceState = writeSn76489Volume(
          traceState,
          channel as 0 | 1 | 2,
          value
        );
        pushTraceLine(
          eventIndex,
          `volume${channel}`,
          "direct",
          "none",
          `R${volumeStep.register}=${volumeStep.value.toString(16)}`
        );
        continue;
      }

      if (eventKind === MkvdrvSongRuntime.EVENT_NOISE_ON) {
        const tone2Period = traceState.tonePeriods[2] ?? 0;
        const tone2Frequency =
          tone2Period > 0 ? this.chipCore.toneFrequencyFromPeriod(tone2Period) : 0;
        const result = writeSn76489NoiseControl(
          traceState,
          value,
          tone2Frequency,
          noiseSettings.mode
        );
        const noiseStep = decomposeSn76489NoiseControlWriteStep(
          result.state.noiseSource,
          noiseSettings.mode
        );
        const [volumeStep] = decomposeSn76489VolumeWrite(3, noiseSettings.volume);
        traceState = result.state;
        traceState = writeSn76489Volume(traceState, 3, noiseSettings.volume);
        pushTraceLine(
          eventIndex,
          "noise",
          "direct",
          result.resetReason,
          `R6=${noiseStep.value.toString(16)}`,
          `${result.state.noiseSource}, mode=${result.state.noiseMode}, R7=${volumeStep.value.toString(
            16
          )}`
        );
        continue;
      }

      if (eventKind === MkvdrvSongRuntime.EVENT_VOLUME && channel === 3) {
        const [volumeStep] = decomposeSn76489VolumeWrite(3, value);
        traceState = writeSn76489Volume(traceState, 3, value);
        pushTraceLine(
          eventIndex,
          "noise volume",
          "direct",
          "none",
          `R${volumeStep.register}=${volumeStep.value.toString(16)}`
        );
      }
    }

    if (lines.length === 0) {
      return "";
    }

    const previewLines = lines.slice(0, 20);
    const suffix =
      lines.length > previewLines.length
        ? `\n... (${lines.length - previewLines.length} more writes)`
        : "";

    return `\nSN write trace:\n${previewLines.join("\n")}${suffix}`;
  }

  process(outputs: Float32Array[][]): boolean {
    const output = outputs[0];

    if (!output) {
      return true;
    }

    const left = output[0];
    const right = output[1];

    if (this.wavetable.length === 0) {
      left.fill(0);
      right?.fill(0);
      return true;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (this.mode === "sequence") {
        while (this.eventSamplesRemaining <= 0) {
          if (this.pendingTerminalAction !== "none") {
            this.resolvePendingTerminalAction();

            if (this.mode !== "sequence" || this.eventSamplesRemaining > 0) {
              break;
            }

            continue;
          }

          this.advanceSequenceEvent();

          if (this.mode !== "sequence") {
            break;
          }
        }
      }

      const hasActiveTone = this.toneChannels.some(
        (channel) =>
          channel.frequency > 0 ||
          channel.amplitude >= 1.0e-4 ||
          channel.targetAmplitude > 0
      );
      const hasActiveNoise =
        this.noiseChannel.frequency > 0 ||
        this.noiseChannel.amplitude >= 1.0e-4 ||
        this.noiseChannel.targetAmplitude > 0;

      if (this.mode === "idle" && !hasActiveTone && !hasActiveNoise) {
        left[index] = 0;
        if (right) {
          right[index] = 0;
        }
      } else {
        const frame = this.renderMixedFrame();
        const leftSample = frame.left * this.masterVolume;
        const rightSample = frame.right * this.masterVolume;

        if (right) {
          left[index] = leftSample;
          right[index] = rightSample;
        } else {
          left[index] = (leftSample + rightSample) * 0.5;
        }
      }

      if (this.mode === "sequence") {
        this.eventSamplesRemaining -= 1;
        this.tickSamplesRemaining -= 1;

        while (this.tickSamplesRemaining <= 0) {
          this.advanceEnvelopeTick();
          this.tickSamplesRemaining += Math.max(1, this.samplesPerTick);
        }
      }
    }

    return true;
  }

  private createToneChannel(): ToneChannelState {
    return {
      phase: 0,
      clockAccumulator: 0,
      counter: 0,
      output: 1,
      frequency: 0,
      baseFrequency: 0,
      tonePeriod: 0,
      baseTonePeriod: 0,
      volumeRegister: 0,
      amplitude: 0,
      targetAmplitude: 0,
      baseAmplitude: 0,
      panMask: MkvdrvSongRuntime.PSG_PAN_BOTH,
      envelopeId: 0,
      pitchEnvelopeId: 0,
      pitchOffset: 0,
      pitchDelayCounter: 0,
      pitchSpeedCounter: 0,
      pitchActive: false,
      envelopeGain: 1,
      envelopeStepIndex: 0,
      envelopeSpeedCounter: 0,
      envelopeActive: false,
      ayHardwareEnvelopeEnabled: false
    };
  }

  private createNoiseChannel(): NoiseChannelState {
    return {
      phase: 0,
      clockAccumulator: 0,
      counter: 0,
      shiftClockOutput: 0,
      frequency: 0,
      baseFrequency: 0,
      noisePeriod: 0,
      baseNoisePeriod: 0,
      frequencyMode: {
        kind: "continuous",
        frequency: 0,
        period: 0
      },
      volumeRegister: 0,
      noiseControlRegister: MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
      amplitude: 0,
      targetAmplitude: 0,
      lfsr: 0x4000,
      output: 1,
      mode: MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
      baseAmplitude: 0,
      panMask: MkvdrvSongRuntime.PSG_PAN_BOTH,
      envelopeId: 0,
      pitchEnvelopeId: 0,
      pitchOffset: 0,
      pitchDelayCounter: 0,
      pitchSpeedCounter: 0,
      pitchActive: false,
      envelopeGain: 1,
      envelopeStepIndex: 0,
      envelopeSpeedCounter: 0,
      envelopeActive: false,
      lastResetReason: "none",
      ayHardwareEnvelopeEnabled: false
    };
  }

  private createAyHardwareEnvelope(): AyHardwareEnvelopeState {
    return {
      shape: 9,
      period: 512,
      clockAccumulator: 0,
      counter: 512,
      step: 15,
      direction: -1,
      hold: true,
      alternate: false,
      continueFlag: false,
      holding: false,
      gain: 1
    };
  }

  private resetChannels() {
    this.toneChannels = Array.from(
      { length: MkvdrvSongRuntime.PSG_TONE_CHANNELS },
      () => this.createToneChannel()
    );
    this.noiseChannel = this.createNoiseChannel();
    this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
    this.ay38910Registers = createAy38910RegisterState();
    this.sn76489Registers = createSn76489RegisterState();
  }

  private silenceAllChannels() {
    this.toneChannels.forEach((channel) => {
      channel.targetAmplitude = 0;
      channel.baseAmplitude = 0;
      channel.frequency = 0;
      channel.clockAccumulator = 0;
      channel.counter = 0;
      channel.output = 1;
      channel.tonePeriod = 0;
      channel.baseTonePeriod = 0;
      channel.volumeRegister = 0;
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
      channel.ayHardwareEnvelopeEnabled = false;
    });
    this.noiseChannel.targetAmplitude = 0;
    this.noiseChannel.baseAmplitude = 0;
    this.noiseChannel.frequency = 0;
    this.noiseChannel.clockAccumulator = 0;
    this.noiseChannel.counter = 0;
    this.noiseChannel.shiftClockOutput = 0;
    this.noiseChannel.noisePeriod = 0;
    this.noiseChannel.baseNoisePeriod = 0;
    this.noiseChannel.frequencyMode = {
      kind: "continuous",
      frequency: 0,
      period: 0
    };
    this.noiseChannel.volumeRegister = 0;
    this.noiseChannel.noiseControlRegister =
      MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE;
    this.noiseChannel.envelopeActive = false;
    this.noiseChannel.envelopeGain = 1;
    this.noiseChannel.lastResetReason = "none";
    this.noiseChannel.ayHardwareEnvelopeEnabled = false;
    this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
    this.ay38910Registers = createAy38910RegisterState();
  }

  private normalizeVolumeRegister(value: number): number {
    return Math.max(0, Math.min(15, Math.round(value)));
  }

  private syncAyToneRegister(
    channelIndex: number,
    channel: ToneChannelState
  ) {
    if (this.chipModel !== "ay38910" || channelIndex > 2) {
      return;
    }

    this.ay38910Registers = writeAy38910TonePeriod(
      this.ay38910Registers,
      channelIndex as 0 | 1 | 2,
      channel.tonePeriod
    );
    this.ay38910Registers = writeAy38910ChannelVolume(
      this.ay38910Registers,
      channelIndex as 0 | 1 | 2,
      channel.volumeRegister,
      channel.ayHardwareEnvelopeEnabled
    );
  }

  private syncAyToneRegisterForChannel(channel: ToneChannelState) {
    if (this.chipModel !== "ay38910") {
      return;
    }

    const channelIndex = this.toneChannels.indexOf(channel);
    if (channelIndex < 0 || channelIndex >= MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
      return;
    }

    this.syncAyToneRegister(channelIndex, channel);
  }

  private syncAyNoiseRegister() {
    if (this.chipModel !== "ay38910") {
      return;
    }

    this.ay38910Registers = writeAy38910NoisePeriod(
      this.ay38910Registers,
      this.noiseChannel.baseNoisePeriod
    );
  }

  private applyToneVolumeRegister(
    channel: ToneChannelState,
    value: number,
    channelIndex?: number
  ) {
    channel.volumeRegister = this.normalizeVolumeRegister(value);
    channel.baseAmplitude =
      this.chipModel === "ay38910" && channelIndex !== undefined && channelIndex <= 2
        ? resolveAy38910ChannelGain(
            this.ay38910Registers,
            channelIndex as 0 | 1 | 2,
            (volume) => this.decodePsgAmplitude(volume),
            this.currentAyHardwareEnvelopeGain()
          )
        : this.decodePsgAmplitude(channel.volumeRegister);
    if (channelIndex !== undefined) {
      this.syncAyToneRegister(channelIndex, channel);
      if (this.chipModel === "ay38910") {
        channel.baseAmplitude = resolveAy38910ChannelGain(
          this.ay38910Registers,
          channelIndex as 0 | 1 | 2,
          (volume) => this.decodePsgAmplitude(volume),
          this.currentAyHardwareEnvelopeGain()
        );
      }
    }
  }

  private applyNoiseVolumeRegister(value: number) {
    this.noiseChannel.volumeRegister = this.normalizeVolumeRegister(value);
    this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(
      this.noiseChannel.volumeRegister
    );
  }

  private resetSn76489NoiseShiftRegister() {
    this.noiseChannel.lfsr = resetSn76489Lfsr();
    this.noiseChannel.output = 1;
    this.noiseChannel.shiftClockOutput = 0;
    this.noiseChannel.clockAccumulator = 0;
    this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
  }

  private applyResolvedSn76489NoiseState(
    tone2Frequency: number,
    resetLfsr: boolean,
    reloadCounter: boolean
  ) {
    const resolved = resolveSn76489NoiseState(this.sn76489Registers, tone2Frequency);
    this.noiseChannel.frequencyMode = resolved.frequencyMode;
    this.noiseChannel.baseNoisePeriod =
      resolved.frequencyMode.kind === "continuous"
        ? resolved.frequencyMode.period
        : 0;
    this.noiseChannel.noisePeriod =
      resolved.frequencyMode.kind === "continuous"
        ? resolved.frequencyMode.period
        : this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
    this.noiseChannel.frequency = resolved.frequency;

    if (resetLfsr) {
      this.resetSn76489NoiseShiftRegister();
      return;
    }

    if (reloadCounter) {
      this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
      this.noiseChannel.clockAccumulator = 0;
    }
  }

  private applySn76489NoiseControlWrite(
    targetFrequency: number,
    noiseMode: number
  ) {
    const tone2Frequency =
      this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
    const result = writeSn76489NoiseControl(
      this.sn76489Registers,
      targetFrequency,
      tone2Frequency,
      noiseMode
    );
    this.sn76489Registers = result.state;
    this.applyResolvedSn76489NoiseState(
      tone2Frequency,
      result.resetLfsr,
      result.reloadCounter
    );
    this.noiseChannel.lastResetReason = result.resetReason;
  }

  private applySn76489NoiseControlUpdate(
    targetFrequency: number,
    noiseMode: number
  ) {
    this.noiseChannel.mode = noiseMode;
    this.noiseChannel.noiseControlRegister = noiseMode;
    this.applySn76489NoiseControlWrite(targetFrequency, noiseMode);
  }

  private refreshSn76489NoiseDerivedState() {
    const tone2Frequency =
      this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
    const previousModeKind = this.noiseChannel.frequencyMode.kind;
    const previousPeriod = this.noiseChannel.noisePeriod;
    const previousFrequency = this.noiseChannel.frequency;
    const resolved = resolveSn76489NoiseState(this.sn76489Registers, tone2Frequency);
    const nextPeriod =
      resolved.frequencyMode.kind === "continuous"
        ? resolved.frequencyMode.period
        : this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
    const derivedStateChanged =
      previousModeKind !== resolved.frequencyMode.kind ||
      previousPeriod !== nextPeriod ||
      Math.abs(previousFrequency - resolved.frequency) > 0.0001;

    this.applyResolvedSn76489NoiseState(tone2Frequency, false, derivedStateChanged);
  }

  private setToneChannel(
    channelIndex: number,
    frequency: number,
    volumeRegister: number,
    restartEnvelope = false
  ) {
    const channel = this.toneChannels[channelIndex];
    if (!channel) {
      return;
    }

    channel.baseFrequency = frequency;
    channel.baseTonePeriod = this.chipCore.tonePeriodFromFrequency(frequency);
    if (this.chipModel === "sn76489" && channelIndex <= 2) {
      this.sn76489Registers = writeSn76489TonePeriod(
        this.sn76489Registers,
        channelIndex as 0 | 1 | 2,
        channel.baseTonePeriod
      );
      this.sn76489Registers = writeSn76489Volume(
        this.sn76489Registers,
        channelIndex as 0 | 1 | 2,
        volumeRegister
      );
    }
    this.applyToneVolumeRegister(channel, volumeRegister, channelIndex);
    if (frequency <= 0 || channel.volumeRegister <= 0) {
      channel.frequency = 0;
      channel.clockAccumulator = 0;
      channel.counter = 0;
      channel.output = 1;
      channel.tonePeriod = 0;
      channel.baseTonePeriod = 0;
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
      channel.pitchActive = false;
      channel.pitchOffset = 0;
    } else {
      this.refreshToneFrequency(channel);
      this.syncAyToneRegister(channelIndex, channel);
      channel.counter = Math.max(1, channel.tonePeriod);
      channel.clockAccumulator = 0;
      channel.output = 1;
    }
    if (restartEnvelope) {
      this.restartToneEnvelope(channel);
      this.restartTonePitchEnvelope(channel);
    }
    this.refreshToneTarget(channel);
  }

  private setNoiseChannel(
    frequency: number,
    volumeRegister: number,
    mode?: number,
    restartEnvelope = false
  ) {
    const nextNoiseMode = mode ?? this.noiseChannel.mode;
    this.noiseChannel.baseFrequency = frequency;
    this.applyNoiseVolumeRegister(volumeRegister);
    if (this.chipModel === "sn76489") {
      this.applySn76489NoiseControlUpdate(frequency, nextNoiseMode);
      this.sn76489Registers = writeSn76489Volume(
        this.sn76489Registers,
        3,
        volumeRegister
      );
    }
    if (frequency <= 0 || this.noiseChannel.volumeRegister <= 0) {
      this.noiseChannel.frequency = 0;
      this.noiseChannel.clockAccumulator = 0;
      this.noiseChannel.counter = 0;
      this.noiseChannel.shiftClockOutput = 0;
      this.noiseChannel.noisePeriod = 0;
      this.noiseChannel.baseNoisePeriod = 0;
      this.noiseChannel.frequencyMode = {
        kind: "continuous",
        frequency: 0,
        period: 0
      };
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
      this.noiseChannel.pitchActive = false;
      this.noiseChannel.pitchOffset = 0;
      this.noiseChannel.lastResetReason = "none";
      this.syncAyNoiseRegister();
    } else {
      this.refreshNoiseFrequency();
      this.syncAyNoiseRegister();
      this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
      this.noiseChannel.clockAccumulator = 0;
      this.noiseChannel.shiftClockOutput = 0;
    }
    if (this.chipModel !== "sn76489" && mode !== undefined) {
      this.noiseChannel.mode = mode;
      this.noiseChannel.noiseControlRegister = mode;
    }
    if (restartEnvelope) {
      this.restartNoiseEnvelope();
      this.restartNoisePitchEnvelope();
    }
    this.refreshNoiseTarget();
    if (frequency > 0) {
      this.noiseChannel.phase = 0;
      this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
      this.noiseChannel.clockAccumulator = 0;
      this.noiseChannel.shiftClockOutput = 0;
      if (this.chipModel !== "sn76489") {
        this.noiseChannel.lfsr = resetSn76489Lfsr();
        this.noiseChannel.output = 1;
      }
    }
  }

  private decodeEnvelopeGain(level: number): number {
    return this.chipCore.decodeEnvelopeGain(level);
  }

  private decodeAyHardwareEnvelopeStep(step: number): number {
    const clampedStep = Math.max(0, Math.min(15, Math.round(step)));
    return this.decodeEnvelopeGain(15 - clampedStep);
  }

  private currentAyHardwareEnvelopeGain(): number {
    return Math.max(0, Math.min(1, this.ayHardwareEnvelope.gain));
  }

  private resolveToneEnvelopeTarget(channel: ToneChannelState): number {
    if (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
      return this.currentAyHardwareEnvelopeGain();
    }
    return channel.baseAmplitude * channel.envelopeGain;
  }

  private resolveNoiseEnvelopeTarget(channel: NoiseChannelState): number {
    if (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
      return this.currentAyHardwareEnvelopeGain();
    }
    return channel.baseAmplitude * channel.envelopeGain;
  }

  private refreshToneTarget(channel: ToneChannelState) {
    channel.targetAmplitude = this.resolveToneEnvelopeTarget(channel);
  }

  private applyPitchOffset(baseFrequency: number, offset: number): number {
    if (baseFrequency <= 0 || offset === 0) {
      return baseFrequency;
    }

    return baseFrequency * 2 ** (offset / 1200);
  }

  private refreshToneFrequency(channel: ToneChannelState) {
    if (channel.baseFrequency <= 0) {
      channel.frequency = 0;
      channel.tonePeriod = 0;
      return;
    }

    const targetFrequency = this.applyPitchOffset(
      channel.baseFrequency,
      channel.pitchOffset
    );
    channel.tonePeriod = this.chipCore.tonePeriodFromFrequency(targetFrequency);
    channel.frequency = this.chipCore.toneFrequencyFromPeriod(channel.tonePeriod);
    this.syncAyToneRegisterForChannel(channel);
  }

  private refreshNoiseFrequency() {
    if (this.noiseChannel.baseFrequency <= 0) {
      this.noiseChannel.frequency = 0;
      this.noiseChannel.noisePeriod = 0;
      this.noiseChannel.baseNoisePeriod = 0;
      this.noiseChannel.frequencyMode = {
        kind: "continuous",
        frequency: 0,
        period: 0
      };
      this.noiseChannel.lastResetReason = "none";
      return;
    }

    const targetFrequency = Math.max(
      1,
      this.applyPitchOffset(
        this.noiseChannel.baseFrequency,
        this.noiseChannel.pitchOffset
      )
    );
    if (this.chipModel === "sn76489") {
      this.refreshSn76489NoiseDerivedState();
      return;
    }
    const tone2Frequency =
      this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
    const frequencyMode = this.chipCore.resolveNoiseFrequencyMode(
      targetFrequency,
      tone2Frequency
    );
    this.noiseChannel.frequencyMode = frequencyMode;

    if (frequencyMode.kind === "tone2") {
      this.noiseChannel.baseNoisePeriod = 0;
      this.noiseChannel.noisePeriod =
        this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
      this.noiseChannel.frequency = tone2Frequency;
      return;
    }

    this.noiseChannel.baseNoisePeriod = frequencyMode.period;
    this.noiseChannel.noisePeriod = frequencyMode.period;
    this.noiseChannel.frequency = frequencyMode.frequency;
    this.syncAyNoiseRegister();
  }

  private refreshNoiseTarget() {
    this.noiseChannel.targetAmplitude = this.resolveNoiseEnvelopeTarget(
      this.noiseChannel
    );
  }

  private restartAyHardwareEnvelope() {
    const { continueFlag, attack, alternate, hold } = parseAyHardwareEnvelopeShape(
      this.ayHardwareEnvelope.shape
    );
    const step = attack ? 0 : 15;

    this.ayHardwareEnvelope = {
      ...this.ayHardwareEnvelope,
      clockAccumulator: 0,
      counter: Math.max(1, this.ayHardwareEnvelope.period),
      step,
      direction: attack ? 1 : -1,
      hold,
      alternate,
      continueFlag,
      holding: false,
      gain: this.decodeAyHardwareEnvelopeStep(step)
    };
    this.refreshAyHardwareEnvelopeTargets();
  }

  private applyAyHardwareEnvelopeShape(shape: number) {
    this.ay38910Registers = writeAy38910EnvelopeShape(this.ay38910Registers, shape);
    this.ayHardwareEnvelope.shape = this.ay38910Registers.envelopeShape;
    this.restartAyHardwareEnvelope();
  }

  private applyAyHardwareEnvelopePeriod(period: number) {
    this.ay38910Registers = writeAy38910EnvelopePeriod(
      this.ay38910Registers,
      period
    );
    this.ayHardwareEnvelope.period = this.ay38910Registers.envelopePeriod;
    this.ayHardwareEnvelope.counter = Math.max(1, this.ayHardwareEnvelope.period);
  }

  private applyAyHardwareEnvelopeEnable(channel: number, enabled: boolean) {
    if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
      const toneChannel = this.toneChannels[channel];
      if (!toneChannel) {
        return;
      }
      toneChannel.ayHardwareEnvelopeEnabled = enabled;
      this.syncAyToneRegister(channel, toneChannel);
      toneChannel.baseAmplitude = resolveAy38910ChannelGain(
        this.ay38910Registers,
        channel as 0 | 1 | 2,
        (volume) => this.decodePsgAmplitude(volume),
        this.currentAyHardwareEnvelopeGain()
      );
      if (enabled) {
        toneChannel.envelopeActive = false;
      }
      this.refreshToneTarget(toneChannel);
      return;
    }

    if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
      this.noiseChannel.ayHardwareEnvelopeEnabled = enabled;
      if (enabled) {
        this.noiseChannel.envelopeActive = false;
      }
      this.refreshNoiseTarget();
    }
  }

  private applyAyMixerToneMask(mask: number) {
    this.ay38910Registers = writeAy38910MixerToneMask(this.ay38910Registers, mask);
  }

  private applyAyMixerNoiseMask(mask: number) {
    this.ay38910Registers = writeAy38910MixerNoiseMask(this.ay38910Registers, mask);
  }

  private isAyToneEnabled(channelIndex: number): boolean {
    return resolveAy38910ToneEnabled(this.ay38910Registers, channelIndex as 0 | 1 | 2);
  }

  private isAyNoiseEnabled(channelIndex: number): boolean {
    return resolveAy38910NoiseEnabled(this.ay38910Registers, channelIndex as 0 | 1 | 2);
  }

  private refreshAyHardwareEnvelopeTargets() {
    if (this.chipModel !== "ay38910") {
      return;
    }

    this.toneChannels.forEach((channel) => {
      if (channel.ayHardwareEnvelopeEnabled) {
        const channelIndex = this.toneChannels.indexOf(channel);
        if (channelIndex >= 0 && channelIndex < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          channel.baseAmplitude = resolveAy38910ChannelGain(
            this.ay38910Registers,
            channelIndex as 0 | 1 | 2,
            (volume) => this.decodePsgAmplitude(volume),
            this.currentAyHardwareEnvelopeGain()
          );
        }
        this.refreshToneTarget(channel);
      }
    });

    if (this.noiseChannel.ayHardwareEnvelopeEnabled) {
      this.refreshNoiseTarget();
    }
  }

  private advanceAyHardwareEnvelopeFrame() {
    if (this.chipModel !== "ay38910") {
      return;
    }

    const step = AY_MASTER_CLOCK_HZ / AY_HARDWARE_ENVELOPE_DIVIDER / this.sampleRateValue;
    this.ayHardwareEnvelope.clockAccumulator += step;

    while (this.ayHardwareEnvelope.clockAccumulator >= 1) {
      this.ayHardwareEnvelope.clockAccumulator -= 1;

      if (this.ayHardwareEnvelope.holding) {
        continue;
      }

      if (this.ayHardwareEnvelope.counter > 1) {
        this.ayHardwareEnvelope.counter -= 1;
        continue;
      }

      this.ayHardwareEnvelope.counter = Math.max(1, this.ayHardwareEnvelope.period);
      const nextStep = this.ayHardwareEnvelope.step + this.ayHardwareEnvelope.direction;

      if (nextStep >= 0 && nextStep <= 15) {
        this.ayHardwareEnvelope.step = nextStep;
      } else {
        const resolution = resolveAyHardwareEnvelopeCycleEnd(this.ayHardwareEnvelope);
        this.ayHardwareEnvelope.step = resolution.step;
        this.ayHardwareEnvelope.direction = resolution.direction;
        this.ayHardwareEnvelope.holding = resolution.holding;
      }
    }

    this.ayHardwareEnvelope.gain = this.decodeAyHardwareEnvelopeStep(
      this.ayHardwareEnvelope.step
    );
    this.refreshAyHardwareEnvelopeTargets();
  }

  private restartToneEnvelope(channel: ToneChannelState) {
    if (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
      this.refreshToneTarget(channel);
      return;
    }
    const envelope = this.resolveEnvelope(channel.envelopeId);
    if (!envelope || envelope.values.length === 0) {
      channel.envelopeActive = false;
      channel.envelopeStepIndex = 0;
      channel.envelopeSpeedCounter = 0;
      channel.envelopeGain = 1;
      return;
    }

    channel.envelopeActive = true;
    channel.envelopeStepIndex = 0;
    channel.envelopeSpeedCounter = 0;
    channel.envelopeGain = this.decodeEnvelopeGain(envelope.values[0] ?? 0);
  }

  private restartNoiseEnvelope() {
    if (this.chipModel === "ay38910" && this.noiseChannel.ayHardwareEnvelopeEnabled) {
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
      this.refreshNoiseTarget();
      return;
    }
    const envelope = this.resolveEnvelope(this.noiseChannel.envelopeId);
    if (!envelope || envelope.values.length === 0) {
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeStepIndex = 0;
      this.noiseChannel.envelopeSpeedCounter = 0;
      this.noiseChannel.envelopeGain = 1;
      return;
    }

    this.noiseChannel.envelopeActive = true;
    this.noiseChannel.envelopeStepIndex = 0;
    this.noiseChannel.envelopeSpeedCounter = 0;
    this.noiseChannel.envelopeGain = this.decodeEnvelopeGain(
      envelope.values[0] ?? 0
    );
  }

  private restartTonePitchEnvelope(channel: ToneChannelState) {
    const envelope = this.pitchEnvelopes.get(channel.pitchEnvelopeId);
    if (!envelope || channel.baseFrequency <= 0) {
      channel.pitchActive = false;
      channel.pitchOffset = 0;
      channel.pitchDelayCounter = 0;
      channel.pitchSpeedCounter = 0;
      this.refreshToneFrequency(channel);
      return;
    }

    channel.pitchActive = true;
    channel.pitchOffset = envelope.initialOffset;
    channel.pitchDelayCounter = envelope.delay;
    channel.pitchSpeedCounter = 0;
    this.refreshToneFrequency(channel);
  }

  private restartNoisePitchEnvelope() {
    const envelope = this.pitchEnvelopes.get(this.noiseChannel.pitchEnvelopeId);
    if (!envelope || this.noiseChannel.baseFrequency <= 0) {
      this.noiseChannel.pitchActive = false;
      this.noiseChannel.pitchOffset = 0;
      this.noiseChannel.pitchDelayCounter = 0;
      this.noiseChannel.pitchSpeedCounter = 0;
      this.refreshNoiseFrequency();
      return;
    }

    this.noiseChannel.pitchActive = true;
    this.noiseChannel.pitchOffset = envelope.initialOffset;
    this.noiseChannel.pitchDelayCounter = envelope.delay;
    this.noiseChannel.pitchSpeedCounter = 0;
    this.refreshNoiseFrequency();
  }

  private advanceChannelEnvelope(channel: ToneChannelState | NoiseChannelState) {
    if (
      !channel.envelopeActive ||
      channel.envelopeId === 0 ||
      (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled)
    ) {
      return;
    }

    const envelope = this.resolveEnvelope(channel.envelopeId);
    if (!envelope || envelope.values.length === 0) {
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
      return;
    }

    channel.envelopeSpeedCounter += 1;
    if (channel.envelopeSpeedCounter < envelope.speed) {
      return;
    }

    channel.envelopeSpeedCounter = 0;
    const nextIndex = channel.envelopeStepIndex + 1;

    if (nextIndex < envelope.values.length) {
      channel.envelopeStepIndex = nextIndex;
      channel.envelopeGain = this.decodeEnvelopeGain(
        envelope.values[nextIndex] ?? 15
      );
      return;
    }

    if (
      envelope.loopStart !== undefined &&
      envelope.loopStart < envelope.values.length
    ) {
      channel.envelopeStepIndex = envelope.loopStart;
      channel.envelopeGain = this.decodeEnvelopeGain(
        envelope.values[channel.envelopeStepIndex] ?? 15
      );
      return;
    }

    channel.envelopeActive = false;
    channel.envelopeGain = this.decodeEnvelopeGain(
      envelope.values[envelope.values.length - 1] ?? 15
    );
  }

  private resolveEnvelope(envelopeId: number): SequenceEnvelope | undefined {
    const envelope = this.envelopes.get(envelopeId);
    if (envelope) {
      return envelope;
    }

    if (this.chipModel === "ay38910" && isPresetEnvelopeId(envelopeId)) {
      return AY_PRESET_ENVELOPES[envelopeId];
    }

    return undefined;
  }

  private advanceTonePitchEnvelope(channel: ToneChannelState) {
    if (!channel.pitchActive || channel.pitchEnvelopeId === 0) {
      return;
    }

    const envelope = this.pitchEnvelopes.get(channel.pitchEnvelopeId);
    if (!envelope) {
      channel.pitchActive = false;
      channel.pitchOffset = 0;
      this.refreshToneFrequency(channel);
      return;
    }

    if (channel.pitchDelayCounter > 0) {
      channel.pitchDelayCounter -= 1;
      return;
    }

    channel.pitchSpeedCounter += 1;
    if (channel.pitchSpeedCounter < envelope.speed) {
      return;
    }

    channel.pitchSpeedCounter = 0;
    channel.pitchOffset += envelope.step;
    this.refreshToneFrequency(channel);
  }

  private advanceNoisePitchEnvelope() {
    if (!this.noiseChannel.pitchActive || this.noiseChannel.pitchEnvelopeId === 0) {
      return;
    }

    const envelope = this.pitchEnvelopes.get(this.noiseChannel.pitchEnvelopeId);
    if (!envelope) {
      this.noiseChannel.pitchActive = false;
      this.noiseChannel.pitchOffset = 0;
      this.refreshNoiseFrequency();
      return;
    }

    if (this.noiseChannel.pitchDelayCounter > 0) {
      this.noiseChannel.pitchDelayCounter -= 1;
      return;
    }

    this.noiseChannel.pitchSpeedCounter += 1;
    if (this.noiseChannel.pitchSpeedCounter < envelope.speed) {
      return;
    }

    this.noiseChannel.pitchSpeedCounter = 0;
    this.noiseChannel.pitchOffset += envelope.step;
    this.refreshNoiseFrequency();
  }

  private advanceEnvelopeTick() {
    this.toneChannels.forEach((channel) => {
      this.advanceChannelEnvelope(channel);
      this.advanceTonePitchEnvelope(channel);
      this.refreshToneTarget(channel);
    });
    this.advanceChannelEnvelope(this.noiseChannel);
    this.advanceNoisePitchEnvelope();
    this.refreshNoiseTarget();
  }

  private decodePsgAmplitude(volume: number): number {
    return this.chipCore.decodeAmplitude(volume);
  }

  private decodeNoiseParam(param: number): { volume: number; mode: number } {
    if (param > 0xff) {
      return {
        volume: param & 0xff,
        mode: (param >>> 8) & 0xff
      };
    }

    return {
      volume: Math.max(0, Math.min(15, param)),
      mode: MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE
    };
  }

  private normalizePanMask(panMask: number): number {
    return panMask & MkvdrvSongRuntime.PSG_PAN_BOTH;
  }

  private applyPanLevel(
    panMask: number,
    sample: number
  ): { left: number; right: number } {
    const normalized = this.normalizePanMask(panMask);
    return {
      left:
        (normalized & MkvdrvSongRuntime.PSG_PAN_LEFT) !== 0 ? sample : 0,
      right:
        (normalized & MkvdrvSongRuntime.PSG_PAN_RIGHT) !== 0 ? sample : 0
    };
  }

  private configureTonePreviewVoices(frequency: number) {
    const previewFrequencies = [frequency, frequency * 1.5, frequency * 2];

    this.toneChannels.forEach((channel, index) => {
      channel.baseFrequency = previewFrequencies[index] ?? frequency;
      channel.baseTonePeriod = this.chipCore.tonePeriodFromFrequency(
      channel.baseFrequency
    );
      this.applyToneVolumeRegister(channel, 15, index);
      channel.panMask = MkvdrvSongRuntime.PSG_PAN_BOTH;
      channel.envelopeId = 0;
      channel.pitchEnvelopeId = 0;
      channel.pitchOffset = 0;
      channel.pitchActive = false;
      channel.envelopeGain = 1;
      channel.envelopeActive = false;
      this.refreshToneFrequency(channel);
      this.refreshToneTarget(channel);
      channel.counter = Math.max(1, channel.tonePeriod);
      channel.clockAccumulator = 0;
      channel.output = 1;
    });
    this.noiseChannel.frequency = 0;
    this.noiseChannel.clockAccumulator = 0;
    this.noiseChannel.counter = 0;
    this.noiseChannel.baseFrequency = 0;
    this.noiseChannel.noisePeriod = 0;
    this.noiseChannel.baseNoisePeriod = 0;
    this.noiseChannel.frequencyMode = {
      kind: "continuous",
      frequency: 0,
      period: 0
    };
    this.noiseChannel.volumeRegister = 0;
    this.noiseChannel.noiseControlRegister =
      MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE;
    this.noiseChannel.baseAmplitude = 0;
    this.noiseChannel.targetAmplitude = 0;
    this.noiseChannel.panMask = MkvdrvSongRuntime.PSG_PAN_BOTH;
    this.noiseChannel.pitchEnvelopeId = 0;
    this.noiseChannel.pitchOffset = 0;
    this.noiseChannel.pitchActive = false;
  }

  private advanceSequenceEvent() {
    if (this.sequenceEvents.length === 0) {
      this.mode = "idle";
      this.silenceAllChannels();
      return;
    }

    const base = this.sequenceIndex * this.eventStride;
    const eventKind = this.sequenceEvents[base];
    const value = this.sequenceEvents[base + 1];
    const lengthTicks = this.sequenceEvents[base + 2];
    const channel = this.sequenceEvents[base + 3] ?? 0;
    const param = this.sequenceEvents[base + 4] ?? 0;
    const noiseSettings = this.decodeNoiseParam(param);

    if (eventKind === MkvdrvSongRuntime.EVENT_NOTE_ON) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        this.setToneChannel(
          channel,
          this.noteFrequencies[value] ?? 0,
          param,
          true
        );
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOTE_OFF) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        this.setToneChannel(channel, 0, 0);
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.setNoiseChannel(0, 0);
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_TEMPO) {
      this.bpm = value;
      this.samplesPerTick = (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_VOLUME) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          this.applyToneVolumeRegister(toneChannel, value, channel);
          this.refreshToneTarget(toneChannel);
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.applyNoiseVolumeRegister(value);
        if (this.chipModel === "sn76489" && this.noiseChannel.baseFrequency > 0) {
          this.applySn76489NoiseControlUpdate(
            this.noiseChannel.baseFrequency,
            param
          );
        } else {
          this.noiseChannel.mode = param;
          this.noiseChannel.noiseControlRegister = param;
        }
        this.refreshNoiseTarget();
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_ENVELOPE_SELECT) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          toneChannel.ayHardwareEnvelopeEnabled = false;
          this.syncAyToneRegister(channel, toneChannel);
          toneChannel.baseAmplitude = resolveAy38910ChannelGain(
            this.ay38910Registers,
            channel as 0 | 1 | 2,
            (volume) => this.decodePsgAmplitude(volume),
            this.currentAyHardwareEnvelopeGain()
          );
          toneChannel.envelopeId = value;
          if (toneChannel.frequency > 0 || toneChannel.baseAmplitude > 0) {
            this.restartToneEnvelope(toneChannel);
            this.refreshToneTarget(toneChannel);
          }
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.noiseChannel.ayHardwareEnvelopeEnabled = false;
        this.noiseChannel.envelopeId = value;
        if (this.noiseChannel.frequency > 0 || this.noiseChannel.baseAmplitude > 0) {
          this.restartNoiseEnvelope();
          this.refreshNoiseTarget();
        }
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_PITCH_ENVELOPE_SELECT) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          toneChannel.pitchEnvelopeId = value;
          if (toneChannel.baseFrequency > 0) {
            this.restartTonePitchEnvelope(toneChannel);
          }
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.noiseChannel.pitchEnvelopeId = value;
        if (this.noiseChannel.baseFrequency > 0) {
          this.restartNoisePitchEnvelope();
        }
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_PAN) {
      const panMask = this.normalizePanMask(value);
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          toneChannel.panMask = panMask;
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.noiseChannel.panMask = panMask;
      }
    } else if (
      eventKind === MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_SHAPE &&
      this.chipModel === "ay38910"
    ) {
      this.applyAyHardwareEnvelopeShape(value);
    } else if (
      eventKind === MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_PERIOD &&
      this.chipModel === "ay38910"
    ) {
      this.applyAyHardwareEnvelopePeriod(value);
    } else if (
      eventKind === MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_ENABLE &&
      this.chipModel === "ay38910"
    ) {
      this.applyAyHardwareEnvelopeEnable(channel, value !== 0);
    } else if (
      eventKind === MkvdrvSongRuntime.EVENT_AY_MIXER_TONE_MASK &&
      this.chipModel === "ay38910"
    ) {
      this.applyAyMixerToneMask(value);
    } else if (
      eventKind === MkvdrvSongRuntime.EVENT_AY_MIXER_NOISE_MASK &&
      this.chipModel === "ay38910"
    ) {
      this.applyAyMixerNoiseMask(value);
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOISE_ON) {
      this.setNoiseChannel(
        value,
        noiseSettings.volume,
        noiseSettings.mode,
        true
      );
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOISE_OFF) {
      this.setNoiseChannel(0, 0);
    } else {
      this.silenceAllChannels();
    }

    const eventCount = this.sequenceEvents.length / this.eventStride;
    const nextSequenceIndex = this.sequenceIndex + 1;

    if (nextSequenceIndex >= eventCount) {
      const terminalDelaySamples = this.readTailDelaySamples();

      if (this.loopsRemaining < 0) {
        if (terminalDelaySamples > 0) {
          this.pendingTerminalAction = "wrap";
          this.eventSamplesRemaining = terminalDelaySamples;
          return;
        }

        this.sequenceIndex = 0;
        this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
        return;
      }

      if (this.loopsRemaining > 0) {
        this.loopsRemaining -= 1;
        if (terminalDelaySamples > 0) {
          this.pendingTerminalAction = "wrap";
          this.eventSamplesRemaining = terminalDelaySamples;
          return;
        }

        this.sequenceIndex = 0;
        this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
        return;
      }

      if (terminalDelaySamples > 0) {
        this.pendingTerminalAction = "stop";
        this.eventSamplesRemaining = terminalDelaySamples;
        return;
      }

      this.sequenceIndex = eventCount;
      this.eventSamplesRemaining = 0;
      this.mode = "idle";
      return;
    }

    this.sequenceIndex = nextSequenceIndex;
    this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
  }

  private resolvePendingTerminalAction() {
    const action = this.pendingTerminalAction;
    this.pendingTerminalAction = "none";

    if (action === "wrap") {
      this.sequenceIndex = 0;
      this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
      return;
    }

    if (action === "stop") {
      this.sequenceIndex = this.sequenceEvents.length / this.eventStride;
      this.eventSamplesRemaining = 0;
      this.mode = "idle";
    }
  }

  private readUpcomingEventDelaySamples(): number {
    if (this.sequenceEvents.length === 0) {
      return 0;
    }

    const nextBase = this.sequenceIndex * this.eventStride;
    const deltaTicks = this.sequenceEvents[nextBase + 2] ?? 0;

    if (deltaTicks <= 0) {
      return 0;
    }

    return Math.max(
      1,
      Math.round(
        (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * deltaTicks
      )
    );
  }

  private readTailDelaySamples(): number {
    if (this.tailTicks <= 0) {
      return 0;
    }

    return Math.max(
      1,
      Math.round(
        (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * this.tailTicks
      )
    );
  }

  private updateEnvelope(current: number, target: number): number {
    const rate = target > current ? this.attackRate : this.releaseRate;
    return current + (target - current) * rate;
  }

  private updateChannelAmplitude(
    current: number,
    target: number,
    usesAyHardwareEnvelope: boolean
  ): number {
    if (this.chipModel === "ay38910" && usesAyHardwareEnvelope) {
      return target;
    }

    return this.updateEnvelope(current, target);
  }

  private syncNoiseFromTone2() {
    if (this.noiseChannel.frequencyMode.kind !== "tone2") {
      return;
    }

    const tone2 = this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1];
    if (!tone2 || tone2.frequency <= 0) {
      this.noiseChannel.frequency = 0;
      this.noiseChannel.noisePeriod = 0;
      this.noiseChannel.counter = 0;
      this.noiseChannel.shiftClockOutput = 0;
      return;
    }

    this.noiseChannel.frequency = tone2.frequency;
    this.noiseChannel.noisePeriod = tone2.tonePeriod;
    this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
    this.noiseChannel.shiftClockOutput = 0;
    if (this.chipModel === "sn76489") {
      this.refreshSn76489NoiseDerivedState();
    }
  }

  private renderSineChannel(channel: ToneChannelState): number {
    const tableLength = this.wavetable.length;
    const phaseStep = (channel.frequency * tableLength) / this.sampleRateValue;
    const tableIndex = Math.floor(channel.phase) % tableLength;
    const nextIndex = (tableIndex + 1) % tableLength;
    const fraction = channel.phase - tableIndex;
    const sample =
      this.wavetable[tableIndex] * (1 - fraction) +
      this.wavetable[nextIndex] * fraction;

    channel.phase += phaseStep;

    if (channel.phase >= tableLength) {
      channel.phase -= tableLength;
    }

    return sample;
  }

  private renderPsgToneChannel(channel: ToneChannelState): number {
    const channelIndex = this.toneChannels.indexOf(channel);
    if (
      this.chipModel === "ay38910" &&
      channelIndex >= 0 &&
      !this.isAyToneEnabled(channelIndex)
    ) {
      return 0;
    }

    if (this.chipModel === "sn76489") {
      return this.renderSn76489ToneChannel(channel);
    }

    const phaseStep = channel.frequency / this.sampleRateValue;
    const cyclePhase = channel.phase - Math.floor(channel.phase);
    const sample = this.chipCore.renderToneSample(cyclePhase);

    channel.phase += phaseStep;
    if (channel.phase >= 1) {
      channel.phase -= Math.floor(channel.phase);
    }

    return sample;
  }

  private renderSn76489ToneChannel(channel: ToneChannelState): number {
    if (channel.tonePeriod <= 0 || channel.frequency <= 0) {
      return 0;
    }

    channel.clockAccumulator += this.chipCore.toneClockStep(this.sampleRateValue);

    while (channel.clockAccumulator >= 1) {
      channel.clockAccumulator -= 1;
      if (channel.counter <= 1) {
        channel.counter = Math.max(1, channel.tonePeriod);
        channel.output *= -1;
      } else {
        channel.counter -= 1;
      }
    }

    return channel.output;
  }

  private renderNoiseChannel(): number {
    if (
      this.noiseChannel.frequency <= 0 &&
      this.noiseChannel.amplitude < 1.0e-4 &&
      this.noiseChannel.targetAmplitude <= 0
    ) {
      return 0;
    }

    if (this.chipModel === "sn76489") {
      return this.renderSn76489NoiseChannel();
    }

    const phaseStep = Math.max(1, this.noiseChannel.frequency) / this.sampleRateValue;
      this.noiseChannel.phase += phaseStep;

    while (this.noiseChannel.phase >= 1) {
      const shifted = shiftSn76489Lfsr(
        this.noiseChannel.lfsr,
        this.noiseChannel.mode
      );
      this.noiseChannel.lfsr = shifted.lfsr;
      this.noiseChannel.output = shifted.output;
      this.noiseChannel.phase -= 1;
    }

    this.noiseChannel.amplitude = this.updateChannelAmplitude(
      this.noiseChannel.amplitude,
      this.noiseChannel.targetAmplitude,
      this.noiseChannel.ayHardwareEnvelopeEnabled
    );
    const noiseLevel = this.chipCore.noiseOutputLevel();
    return this.noiseChannel.output * this.noiseChannel.amplitude * noiseLevel;
  }

  private renderSn76489NoiseChannel(): number {
    this.noiseChannel.clockAccumulator += this.chipCore.noiseClockStep(
      this.sampleRateValue
    );

    while (this.noiseChannel.clockAccumulator >= 1) {
      this.noiseChannel.clockAccumulator -= 1;

      if (this.noiseChannel.counter <= 1) {
        this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
        this.noiseChannel.shiftClockOutput =
          this.noiseChannel.shiftClockOutput === 0 ? 1 : 0;

        if (this.noiseChannel.shiftClockOutput === 1) {
          const shifted = shiftSn76489Lfsr(
            this.noiseChannel.lfsr,
            this.noiseChannel.mode
          );
          this.noiseChannel.lfsr = shifted.lfsr;
          this.noiseChannel.output = shifted.output;
        }
      } else {
        this.noiseChannel.counter -= 1;
      }
    }

    this.noiseChannel.amplitude = this.updateChannelAmplitude(
      this.noiseChannel.amplitude,
      this.noiseChannel.targetAmplitude,
      this.noiseChannel.ayHardwareEnvelopeEnabled
    );
    const noiseLevel = this.chipCore.noiseOutputLevel();
    return this.noiseChannel.output * this.noiseChannel.amplitude * noiseLevel;
  }

  private renderMixedFrame(): { left: number; right: number } {
    let left = 0;
    let right = 0;

    this.advanceAyHardwareEnvelopeFrame();

    this.toneChannels.forEach((channel) => {
      channel.amplitude = this.updateChannelAmplitude(
        channel.amplitude,
        channel.targetAmplitude,
        channel.ayHardwareEnvelopeEnabled
      );

      if (channel.frequency <= 0 || channel.amplitude < 1.0e-4) {
        return;
      }

      const sample =
        this.renderEngine === "psg"
          ? this.renderPsgToneChannel(channel)
          : this.renderSineChannel(channel);
      const outputLevel =
        this.renderEngine === "psg"
          ? this.chipCore.toneOutputLevel()
          : 0.22;
      const panned = this.applyPanLevel(
        channel.panMask,
        sample * channel.amplitude * outputLevel
      );
      left += panned.left;
      right += panned.right;
    });

    if (this.renderEngine === "psg") {
      this.syncNoiseFromTone2();
      const noiseSample = this.renderNoiseChannel();
      if (this.chipModel === "ay38910") {
        const enabledToneChannels = this.toneChannels
          .map((channel, index) => ({ channel, index }))
          .filter(({ index }) => this.isAyNoiseEnabled(index));
        const divisor = Math.max(1, enabledToneChannels.length);

        enabledToneChannels.forEach(({ channel }) => {
          const pannedNoise = this.applyPanLevel(
            channel.panMask,
            noiseSample / divisor
          );
          left += pannedNoise.left;
          right += pannedNoise.right;
        });
      } else {
        const pannedNoise = this.applyPanLevel(
          this.noiseChannel.panMask,
          noiseSample
        );
        left += pannedNoise.left;
        right += pannedNoise.right;
      }
    }

    return {
      left: left / 4,
      right: right / 4
    };
  }
}
