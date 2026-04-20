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
  createSn76489RegisterState,
  resolveSn76489NoiseState,
  writeSn76489NoiseControl,
  writeSn76489TonePeriod,
  writeSn76489Volume,
  type Sn76489RegisterState
} from "./chips/sn76489-core";

type PlaybackMode = "idle" | "tone" | "sequence";

type ToneChannelState = {
  phase: number;
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
};

type NoiseChannelState = {
  phase: number;
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
};

type TerminalAction = "none" | "stop" | "wrap";

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
  private sn76489Registers: Sn76489RegisterState = createSn76489RegisterState();

  constructor(private readonly sampleRateValue: number) {
    this.samplesPerTick = sampleRateValue / 192;
    this.tickSamplesRemaining = this.samplesPerTick;
    this.noiseChannel = this.createNoiseChannel();
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
    this.envelopes = new Map(
      payload.envelopes.map((envelope) => [envelope.id, envelope])
    );
    this.pitchEnvelopes = new Map(
      payload.pitchEnvelopes.map((envelope) => [envelope.id, envelope])
    );
    this.sequenceIndex = 0;
    this.eventSamplesRemaining = 0;
    this.pendingTerminalAction = "none";
    this.resetChannels();
    this.advanceSequenceEvent();

    return `Sequence ready.\nChip: ${this.chipModel}\nTempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}, loop: ${this.loopCount}`;
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
      envelopeActive: false
    };
  }

  private createNoiseChannel(): NoiseChannelState {
    return {
      phase: 0,
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
      envelopeActive: false
    };
  }

  private resetChannels() {
    this.toneChannels = Array.from(
      { length: MkvdrvSongRuntime.PSG_TONE_CHANNELS },
      () => this.createToneChannel()
    );
    this.noiseChannel = this.createNoiseChannel();
    this.sn76489Registers = createSn76489RegisterState();
  }

  private silenceAllChannels() {
    this.toneChannels.forEach((channel) => {
      channel.targetAmplitude = 0;
      channel.baseAmplitude = 0;
      channel.frequency = 0;
      channel.tonePeriod = 0;
      channel.baseTonePeriod = 0;
      channel.volumeRegister = 0;
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
    });
    this.noiseChannel.targetAmplitude = 0;
    this.noiseChannel.baseAmplitude = 0;
    this.noiseChannel.frequency = 0;
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
  }

  private normalizeVolumeRegister(value: number): number {
    return Math.max(0, Math.min(15, Math.round(value)));
  }

  private applyToneVolumeRegister(channel: ToneChannelState, value: number) {
    channel.volumeRegister = this.normalizeVolumeRegister(value);
    channel.baseAmplitude = this.decodePsgAmplitude(channel.volumeRegister);
  }

  private applyNoiseVolumeRegister(value: number) {
    this.noiseChannel.volumeRegister = this.normalizeVolumeRegister(value);
    this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(
      this.noiseChannel.volumeRegister
    );
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
    this.applyToneVolumeRegister(channel, volumeRegister);
    if (frequency <= 0 || channel.volumeRegister <= 0) {
      channel.frequency = 0;
      channel.tonePeriod = 0;
      channel.baseTonePeriod = 0;
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
      channel.pitchActive = false;
      channel.pitchOffset = 0;
    } else {
      this.refreshToneFrequency(channel);
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
    this.noiseChannel.baseFrequency = frequency;
    this.applyNoiseVolumeRegister(volumeRegister);
    if (this.chipModel === "sn76489") {
      const tone2Frequency =
        this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
      this.sn76489Registers = writeSn76489NoiseControl(
        this.sn76489Registers,
        frequency,
        tone2Frequency,
        mode ?? this.noiseChannel.mode
      );
      this.sn76489Registers = writeSn76489Volume(
        this.sn76489Registers,
        3,
        volumeRegister
      );
    }
    if (frequency <= 0 || this.noiseChannel.volumeRegister <= 0) {
      this.noiseChannel.frequency = 0;
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
    } else {
      this.refreshNoiseFrequency();
    }
    if (mode !== undefined) {
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
      this.noiseChannel.lfsr = 0x4000;
      this.noiseChannel.output = 1;
    }
  }

  private decodeEnvelopeGain(level: number): number {
    return this.chipCore.decodeEnvelopeGain(level);
  }

  private refreshToneTarget(channel: ToneChannelState) {
    channel.targetAmplitude = channel.baseAmplitude * channel.envelopeGain;
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
      return;
    }

    const targetFrequency = Math.max(
      1,
      this.applyPitchOffset(
        this.noiseChannel.baseFrequency,
        this.noiseChannel.pitchOffset
      )
    );
    const tone2Frequency =
      this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
    if (this.chipModel === "sn76489") {
      this.sn76489Registers = writeSn76489NoiseControl(
        this.sn76489Registers,
        targetFrequency,
        tone2Frequency,
        this.noiseChannel.mode
      );
      const resolved = resolveSn76489NoiseState(
        this.sn76489Registers,
        tone2Frequency
      );
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
      return;
    }
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
  }

  private refreshNoiseTarget() {
    this.noiseChannel.targetAmplitude =
      this.noiseChannel.baseAmplitude * this.noiseChannel.envelopeGain;
  }

  private restartToneEnvelope(channel: ToneChannelState) {
    const envelope = this.envelopes.get(channel.envelopeId);
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
    const envelope = this.envelopes.get(this.noiseChannel.envelopeId);
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
    if (!channel.envelopeActive || channel.envelopeId === 0) {
      return;
    }

    const envelope = this.envelopes.get(channel.envelopeId);
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
      this.applyToneVolumeRegister(channel, 15);
      channel.panMask = MkvdrvSongRuntime.PSG_PAN_BOTH;
      channel.envelopeId = 0;
      channel.pitchEnvelopeId = 0;
      channel.pitchOffset = 0;
      channel.pitchActive = false;
      channel.envelopeGain = 1;
      channel.envelopeActive = false;
      this.refreshToneFrequency(channel);
      this.refreshToneTarget(channel);
    });
    this.noiseChannel.frequency = 0;
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
          this.applyToneVolumeRegister(toneChannel, value);
          this.refreshToneTarget(toneChannel);
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.applyNoiseVolumeRegister(value);
        this.noiseChannel.mode = param;
        this.noiseChannel.noiseControlRegister = param;
        this.refreshNoiseTarget();
      }
    } else if (eventKind === MkvdrvSongRuntime.EVENT_ENVELOPE_SELECT) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          toneChannel.envelopeId = value;
          if (toneChannel.frequency > 0 || toneChannel.baseAmplitude > 0) {
            this.restartToneEnvelope(toneChannel);
            this.refreshToneTarget(toneChannel);
          }
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
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

  private syncNoiseFromTone2() {
    if (this.noiseChannel.frequencyMode.kind !== "tone2") {
      return;
    }

    const tone2 = this.toneChannels[MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1];
    if (!tone2 || tone2.frequency <= 0) {
      this.noiseChannel.frequency = 0;
      this.noiseChannel.noisePeriod = 0;
      return;
    }

    this.noiseChannel.frequency = tone2.frequency;
    this.noiseChannel.noisePeriod = tone2.tonePeriod;
    if (this.chipModel === "sn76489") {
      this.sn76489Registers = writeSn76489NoiseControl(
        this.sn76489Registers,
        tone2.frequency,
        tone2.frequency,
        this.noiseChannel.mode
      );
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
    const phaseStep = channel.frequency / this.sampleRateValue;
    const cyclePhase = channel.phase - Math.floor(channel.phase);
    const sample = this.chipCore.renderToneSample(cyclePhase);

    channel.phase += phaseStep;
    if (channel.phase >= 1) {
      channel.phase -= Math.floor(channel.phase);
    }

    return sample;
  }

  private renderNoiseChannel(): number {
    if (
      this.noiseChannel.frequency <= 0 &&
      this.noiseChannel.amplitude < 1.0e-4 &&
      this.noiseChannel.targetAmplitude <= 0
    ) {
      return 0;
    }

    const phaseStep = Math.max(1, this.noiseChannel.frequency) / this.sampleRateValue;
    this.noiseChannel.phase += phaseStep;

    while (this.noiseChannel.phase >= 1) {
      const feedbackBit =
        this.noiseChannel.mode === MkvdrvSongRuntime.PSG_NOISE_MODE_PERIODIC
          ? this.periodicNoiseFeedbackBit()
          : this.whiteNoiseFeedbackBit();
      const feedback = feedbackBit << 14;
      this.noiseChannel.lfsr = (this.noiseChannel.lfsr >> 1) | feedback;
      this.noiseChannel.output = this.noiseChannel.lfsr & 1 ? 1 : -1;
      this.noiseChannel.phase -= 1;
    }

    this.noiseChannel.amplitude = this.updateEnvelope(
      this.noiseChannel.amplitude,
      this.noiseChannel.targetAmplitude
    );
    const noiseLevel = this.chipCore.noiseOutputLevel();
    return this.noiseChannel.output * this.noiseChannel.amplitude * noiseLevel;
  }

  private periodicNoiseFeedbackBit(): number {
    return this.chipCore.periodicNoiseFeedbackBit(this.noiseChannel.lfsr);
  }

  private whiteNoiseFeedbackBit(): number {
    return this.chipCore.whiteNoiseFeedbackBit(this.noiseChannel.lfsr);
  }

  private renderMixedFrame(): { left: number; right: number } {
    let left = 0;
    let right = 0;

    this.toneChannels.forEach((channel) => {
      channel.amplitude = this.updateEnvelope(
        channel.amplitude,
        channel.targetAmplitude
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
      const pannedNoise = this.applyPanLevel(
        this.noiseChannel.panMask,
        this.renderNoiseChannel()
      );
      left += pannedNoise.left;
      right += pannedNoise.right;
    }

    return {
      left: left / 4,
      right: right / 4
    };
  }
}
