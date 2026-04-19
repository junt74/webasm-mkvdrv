import type {
  RenderEngine,
  SequenceEnvelope,
  SequencePayload
} from "./song-format";

type PlaybackMode = "idle" | "tone" | "sequence";

type ToneChannelState = {
  phase: number;
  frequency: number;
  amplitude: number;
  targetAmplitude: number;
  baseAmplitude: number;
  envelopeId: number;
  envelopeGain: number;
  envelopeStepIndex: number;
  envelopeSpeedCounter: number;
  envelopeActive: boolean;
};

type NoiseChannelState = {
  phase: number;
  frequency: number;
  amplitude: number;
  targetAmplitude: number;
  lfsr: number;
  output: number;
  mode: number;
  baseAmplitude: number;
  envelopeId: number;
  envelopeGain: number;
  envelopeStepIndex: number;
  envelopeSpeedCounter: number;
  envelopeActive: boolean;
};

export class MkvdrvSongRuntime {
  static readonly EVENT_NOTE_ON = 1;
  static readonly EVENT_NOTE_OFF = 2;
  static readonly EVENT_TEMPO = 3;
  static readonly EVENT_VOLUME = 4;
  static readonly EVENT_NOISE_ON = 5;
  static readonly EVENT_NOISE_OFF = 6;
  static readonly EVENT_ENVELOPE_SELECT = 7;
  static readonly PSG_TONE_CHANNELS = 3;
  static readonly PSG_NOISE_CHANNEL = 3;
  static readonly PSG_NOISE_MODE_PERIODIC = 0;
  static readonly PSG_NOISE_MODE_WHITE = 1;

  private wavetable = new Float32Array([0]);
  private noteFrequencies = new Float32Array(128);
  private renderEngine: RenderEngine = "an74689";
  private sequenceEvents = new Uint32Array(0);
  private eventStride = 5;
  private previewFrequency = 440;
  private mode: PlaybackMode = "idle";
  private attackRate = 0.0035;
  private releaseRate = 0.0018;
  private bpm = 124;
  private ticksPerBeat = 96;
  private sequenceIndex = 0;
  private eventSamplesRemaining = 0;
  private samplesPerTick: number;
  private tickSamplesRemaining: number;
  private masterVolume = 1;
  private envelopes = new Map<number, SequenceEnvelope>();
  private toneChannels: ToneChannelState[] = [];
  private noiseChannel: NoiseChannelState;

  constructor(private readonly sampleRateValue: number) {
    this.samplesPerTick = sampleRateValue / 192;
    this.tickSamplesRemaining = this.samplesPerTick;
    this.noiseChannel = this.createNoiseChannel();
    this.resetChannels();
  }

  configure({
    renderEngine,
    wavetable,
    noteFrequencies,
    frequency
  }: {
    renderEngine: RenderEngine;
    wavetable: Float32Array;
    noteFrequencies: Float32Array;
    frequency: number;
  }): string {
    this.renderEngine = renderEngine;
    this.wavetable = new Float32Array(wavetable);
    this.noteFrequencies = new Float32Array(noteFrequencies);
    this.previewFrequency = frequency;
    this.resetChannels();
    this.configureTonePreviewVoices(frequency);

    return `AudioWorklet ready.\nEngine: ${this.renderEngine}\nFrequency: ${this.previewFrequency.toFixed(0)} Hz`;
  }

  startTone(): void {
    this.mode = "tone";
    this.configureTonePreviewVoices(this.previewFrequency);
  }

  loadSequence(payload: SequencePayload): string {
    this.mode = "sequence";
    this.bpm = payload.bpm;
    this.ticksPerBeat = payload.ticksPerBeat;
    this.samplesPerTick = (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue;
    this.tickSamplesRemaining = this.samplesPerTick;
    this.sequenceEvents = new Uint32Array(payload.sequenceEvents);
    this.eventStride = payload.eventStride;
    this.envelopes = new Map(
      payload.envelopes.map((envelope) => [envelope.id, envelope])
    );
    this.sequenceIndex = 0;
    this.eventSamplesRemaining = 0;
    this.resetChannels();
    this.advanceSequenceEvent();

    return `Sequence ready.\nTempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}`;
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
    const right = output[1] ?? output[0];

    if (this.wavetable.length === 0) {
      left.fill(0);
      right.fill(0);
      return true;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (this.mode === "sequence") {
        while (this.eventSamplesRemaining <= 0) {
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
        right[index] = 0;
      } else {
        const sample = this.renderMixedSample() * this.masterVolume;
        left[index] = sample;
        right[index] = sample;
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
      amplitude: 0,
      targetAmplitude: 0,
      baseAmplitude: 0,
      envelopeId: 0,
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
      amplitude: 0,
      targetAmplitude: 0,
      lfsr: 0x4000,
      output: 1,
      mode: MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
      baseAmplitude: 0,
      envelopeId: 0,
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
  }

  private silenceAllChannels() {
    this.toneChannels.forEach((channel) => {
      channel.targetAmplitude = 0;
      channel.baseAmplitude = 0;
      channel.frequency = 0;
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
    });
    this.noiseChannel.targetAmplitude = 0;
    this.noiseChannel.baseAmplitude = 0;
    this.noiseChannel.frequency = 0;
    this.noiseChannel.envelopeActive = false;
    this.noiseChannel.envelopeGain = 1;
  }

  private setToneChannel(
    channelIndex: number,
    frequency: number,
    targetAmplitude: number,
    restartEnvelope = false
  ) {
    const channel = this.toneChannels[channelIndex];
    if (!channel) {
      return;
    }

    channel.frequency = frequency;
    channel.baseAmplitude = targetAmplitude;
    if (frequency <= 0 || targetAmplitude <= 0) {
      channel.envelopeActive = false;
      channel.envelopeGain = 1;
    }
    if (restartEnvelope) {
      this.restartToneEnvelope(channel);
    }
    this.refreshToneTarget(channel);
  }

  private setNoiseChannel(
    frequency: number,
    targetAmplitude: number,
    mode?: number,
    restartEnvelope = false
  ) {
    this.noiseChannel.frequency = frequency;
    this.noiseChannel.baseAmplitude = targetAmplitude;
    if (frequency <= 0 || targetAmplitude <= 0) {
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
    }
    if (mode !== undefined) {
      this.noiseChannel.mode = mode;
    }
    if (restartEnvelope) {
      this.restartNoiseEnvelope();
    }
    this.refreshNoiseTarget();
    if (frequency > 0) {
      this.noiseChannel.phase = 0;
      this.noiseChannel.lfsr = 0x4000;
      this.noiseChannel.output = 1;
    }
  }

  private decodeEnvelopeGain(level: number): number {
    const clamped = Math.max(0, Math.min(15, level));
    if (clamped >= 15) {
      return 0;
    }
    return 10 ** (-(clamped * 2) / 20);
  }

  private refreshToneTarget(channel: ToneChannelState) {
    channel.targetAmplitude = channel.baseAmplitude * channel.envelopeGain;
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

  private advanceEnvelopeTick() {
    this.toneChannels.forEach((channel) => {
      this.advanceChannelEnvelope(channel);
      this.refreshToneTarget(channel);
    });
    this.advanceChannelEnvelope(this.noiseChannel);
    this.refreshNoiseTarget();
  }

  private decodePsgAmplitude(volume: number): number {
    const clamped = Math.max(0, Math.min(15, volume));

    if (clamped === 0) {
      return 0;
    }

    const attenuationSteps = 15 - clamped;
    return 10 ** (-(attenuationSteps * 2) / 20);
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

  private configureTonePreviewVoices(frequency: number) {
    const previewFrequencies = [frequency, frequency * 1.5, frequency * 2];

    this.toneChannels.forEach((channel, index) => {
      channel.frequency = previewFrequencies[index] ?? frequency;
      channel.baseAmplitude = this.decodePsgAmplitude(15);
      channel.envelopeId = 0;
      channel.envelopeGain = 1;
      channel.envelopeActive = false;
      this.refreshToneTarget(channel);
    });
    this.noiseChannel.frequency = 0;
    this.noiseChannel.baseAmplitude = 0;
    this.noiseChannel.targetAmplitude = 0;
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
    const toneAmplitude = this.decodePsgAmplitude(param);
    const noiseSettings = this.decodeNoiseParam(param);
    const noiseAmplitude = this.decodePsgAmplitude(noiseSettings.volume);

    if (eventKind === MkvdrvSongRuntime.EVENT_NOTE_ON) {
      const eventSamples = Math.max(
        1,
        Math.round((60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * lengthTicks)
      );
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        this.setToneChannel(
          channel,
          this.noteFrequencies[value] ?? 0,
          toneAmplitude || this.decodePsgAmplitude(15),
          true
        );
      }
      this.eventSamplesRemaining = eventSamples;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOTE_OFF) {
      const eventSamples = Math.max(
        1,
        Math.round((60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * lengthTicks)
      );
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        this.setToneChannel(channel, 0, 0);
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.setNoiseChannel(0, 0);
      }
      this.eventSamplesRemaining = eventSamples;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_TEMPO) {
      this.bpm = value;
      this.samplesPerTick = (60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue;
      this.eventSamplesRemaining = 0;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_VOLUME) {
      if (channel < MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (toneChannel) {
          toneChannel.baseAmplitude = this.decodePsgAmplitude(value);
          this.refreshToneTarget(toneChannel);
        }
      } else if (channel === MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(value);
        this.noiseChannel.mode = param;
        this.refreshNoiseTarget();
      }
      this.eventSamplesRemaining = 0;
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
      this.eventSamplesRemaining = 0;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOISE_ON) {
      const eventSamples = Math.max(
        1,
        Math.round((60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * lengthTicks)
      );
      this.setNoiseChannel(
        value,
        noiseAmplitude || this.decodePsgAmplitude(8),
        noiseSettings.mode,
        true
      );
      this.eventSamplesRemaining = eventSamples;
    } else if (eventKind === MkvdrvSongRuntime.EVENT_NOISE_OFF) {
      const eventSamples = Math.max(
        1,
        Math.round((60 / this.bpm / this.ticksPerBeat) * this.sampleRateValue * lengthTicks)
      );
      this.setNoiseChannel(0, 0);
      this.eventSamplesRemaining = eventSamples;
    } else {
      this.silenceAllChannels();
      this.eventSamplesRemaining = 0;
    }

    this.sequenceIndex =
      (this.sequenceIndex + 1) % (this.sequenceEvents.length / this.eventStride);
  }

  private updateEnvelope(current: number, target: number): number {
    const rate = target > current ? this.attackRate : this.releaseRate;
    return current + (target - current) * rate;
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
    const sample = cyclePhase < 0.5 ? 1 : -1;

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
          ? this.noiseChannel.lfsr & 1
          : (this.noiseChannel.lfsr ^ (this.noiseChannel.lfsr >> 1)) & 1;
      const feedback = feedbackBit << 14;
      this.noiseChannel.lfsr = (this.noiseChannel.lfsr >> 1) | feedback;
      this.noiseChannel.output = this.noiseChannel.lfsr & 1 ? 1 : -1;
      this.noiseChannel.phase -= 1;
    }

    this.noiseChannel.amplitude = this.updateEnvelope(
      this.noiseChannel.amplitude,
      this.noiseChannel.targetAmplitude
    );
    return this.noiseChannel.output * this.noiseChannel.amplitude * 0.1;
  }

  private renderMixedSample(): number {
    let mix = 0;

    this.toneChannels.forEach((channel) => {
      channel.amplitude = this.updateEnvelope(
        channel.amplitude,
        channel.targetAmplitude
      );

      if (channel.frequency <= 0 || channel.amplitude < 1.0e-4) {
        return;
      }

      const sample =
        this.renderEngine === "an74689"
          ? this.renderPsgToneChannel(channel)
          : this.renderSineChannel(channel);
      const outputLevel = this.renderEngine === "an74689" ? 0.12 : 0.22;
      mix += sample * channel.amplitude * outputLevel;
    });

    if (this.renderEngine === "an74689") {
      mix += this.renderNoiseChannel();
    }

    return mix / 4;
  }
}
