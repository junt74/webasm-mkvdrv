"use strict";
(() => {
  // src/chips/ay38910-core.ts
  var DB_PER_STEP = 1.5;
  var MASTER_CLOCK_HZ = 1789773;
  var TONE_DIVIDER = 16;
  var NOISE_DIVIDER = 16;
  var MIN_PERIOD = 1;
  var MAX_TONE_PERIOD = 4095;
  var MAX_NOISE_PERIOD = 31;
  function clampNibble(value) {
    return Math.max(0, Math.min(15, value));
  }
  function clampPeriod(value, max) {
    return Math.max(MIN_PERIOD, Math.min(max, Math.round(value)));
  }
  var ay38910Core = {
    chipModel: "ay38910",
    decodeEnvelopeGain(level) {
      const clamped = clampNibble(level);
      if (clamped >= 15) {
        return 0;
      }
      return 10 ** (-(clamped * DB_PER_STEP) / 20);
    },
    decodeAmplitude(volume) {
      const clamped = clampNibble(volume);
      if (clamped === 0) {
        return 0;
      }
      const attenuationSteps = 15 - clamped;
      return 10 ** (-(attenuationSteps * DB_PER_STEP) / 20);
    },
    toneOutputLevel() {
      return 0.1;
    },
    noiseOutputLevel() {
      return 0.07;
    },
    tonePeriodFromFrequency(frequency) {
      if (frequency <= 0) {
        return 0;
      }
      return clampPeriod(MASTER_CLOCK_HZ / (TONE_DIVIDER * frequency), MAX_TONE_PERIOD);
    },
    toneFrequencyFromPeriod(period) {
      if (period <= 0) {
        return 0;
      }
      return MASTER_CLOCK_HZ / (TONE_DIVIDER * clampPeriod(period, MAX_TONE_PERIOD));
    },
    noisePeriodFromFrequency(frequency) {
      if (frequency <= 0) {
        return 0;
      }
      return clampPeriod(MASTER_CLOCK_HZ / (NOISE_DIVIDER * frequency), MAX_NOISE_PERIOD);
    },
    noiseFrequencyFromPeriod(period) {
      if (period <= 0) {
        return 0;
      }
      return MASTER_CLOCK_HZ / (NOISE_DIVIDER * clampPeriod(period, MAX_NOISE_PERIOD));
    },
    resolveNoiseFrequencyMode(targetFrequency, _tone2Frequency) {
      if (targetFrequency <= 0) {
        return {
          kind: "continuous",
          frequency: 0,
          period: 0
        };
      }
      const period = clampPeriod(
        MASTER_CLOCK_HZ / (NOISE_DIVIDER * targetFrequency),
        MAX_NOISE_PERIOD
      );
      return {
        kind: "continuous",
        frequency: MASTER_CLOCK_HZ / (NOISE_DIVIDER * period),
        period
      };
    },
    renderToneSample(phase) {
      return phase < 0.5 ? 0.85 : -0.85;
    },
    periodicNoiseFeedbackBit(lfsr) {
      return lfsr >> 3 & 1;
    },
    whiteNoiseFeedbackBit(lfsr) {
      return (lfsr ^ lfsr >> 2 ^ lfsr >> 3 ^ lfsr >> 5) & 1;
    }
  };

  // src/chips/sn76489-core.ts
  var DB_PER_STEP2 = 2;
  var MASTER_CLOCK_HZ2 = 3579545;
  var TONE_DIVIDER2 = 32;
  var NOISE_DIVIDER2 = 32;
  var MIN_PERIOD2 = 1;
  var MAX_TONE_PERIOD2 = 1023;
  var MAX_NOISE_PERIOD2 = 1023;
  var DISCRETE_NOISE_PERIODS = [16, 32, 64];
  function clampNibble2(value) {
    return Math.max(0, Math.min(15, value));
  }
  function clampPeriod2(value, max) {
    return Math.max(MIN_PERIOD2, Math.min(max, Math.round(value)));
  }
  function discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency) {
    if (targetFrequency <= 0) {
      return {
        kind: "continuous",
        frequency: 0,
        period: 0
      };
    }
    const fixedCandidates = DISCRETE_NOISE_PERIODS.map((period) => {
      const frequency = MASTER_CLOCK_HZ2 / (NOISE_DIVIDER2 * period);
      return {
        kind: "continuous",
        frequency,
        period
      };
    });
    const candidates = fixedCandidates.map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.frequency - targetFrequency)
    }));
    if (tone2Frequency > 0) {
      candidates.push({
        kind: "tone2",
        distance: Math.abs(tone2Frequency - targetFrequency)
      });
    }
    candidates.sort((left, right) => left.distance - right.distance);
    const best = candidates[0];
    if (!best) {
      return {
        kind: "continuous",
        frequency: 0,
        period: 0
      };
    }
    if (best.kind === "tone2") {
      return { kind: "tone2" };
    }
    return {
      kind: "continuous",
      frequency: best.frequency,
      period: best.period
    };
  }
  function frequencyForNoiseSource(source, tone2Frequency) {
    if (source === "tone2") {
      return Math.max(0, tone2Frequency);
    }
    const period = source === "clock_div_512" ? DISCRETE_NOISE_PERIODS[0] : source === "clock_div_1024" ? DISCRETE_NOISE_PERIODS[1] : DISCRETE_NOISE_PERIODS[2];
    return MASTER_CLOCK_HZ2 / (NOISE_DIVIDER2 * period);
  }
  function sourceForDiscretePeriod(period) {
    if (period <= DISCRETE_NOISE_PERIODS[0]) {
      return "clock_div_512";
    }
    if (period <= DISCRETE_NOISE_PERIODS[1]) {
      return "clock_div_1024";
    }
    return "clock_div_2048";
  }
  function createSn76489RegisterState() {
    return {
      tonePeriods: [0, 0, 0],
      volumeRegisters: [0, 0, 0, 0],
      noiseMode: 1,
      noiseSource: "clock_div_1024",
      latchedRegister: 0
    };
  }
  function writeSn76489TonePeriod(state, channel, period) {
    const next = {
      ...state,
      tonePeriods: [...state.tonePeriods],
      volumeRegisters: [...state.volumeRegisters],
      latchedRegister: channel * 2
    };
    next.tonePeriods[channel] = clampPeriod2(period, MAX_TONE_PERIOD2);
    return next;
  }
  function writeSn76489Volume(state, channel, volume) {
    const next = {
      ...state,
      tonePeriods: [...state.tonePeriods],
      volumeRegisters: [...state.volumeRegisters],
      latchedRegister: channel * 2 + 1
    };
    next.volumeRegisters[channel] = clampNibble2(volume);
    return next;
  }
  function writeSn76489NoiseControl(state, targetFrequency, tone2Frequency, noiseMode) {
    const resolved = discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
    const next = {
      ...state,
      tonePeriods: [...state.tonePeriods],
      volumeRegisters: [...state.volumeRegisters],
      latchedRegister: 6
    };
    next.noiseMode = noiseMode;
    if (resolved.kind === "tone2") {
      next.noiseSource = "tone2";
      return next;
    }
    next.noiseSource = sourceForDiscretePeriod(resolved.period);
    return next;
  }
  function resolveSn76489NoiseState(state, tone2Frequency) {
    if (state.noiseSource === "tone2") {
      return {
        frequency: Math.max(0, tone2Frequency),
        frequencyMode: { kind: "tone2" }
      };
    }
    const frequency = frequencyForNoiseSource(state.noiseSource, tone2Frequency);
    const period = state.noiseSource === "clock_div_512" ? DISCRETE_NOISE_PERIODS[0] : state.noiseSource === "clock_div_1024" ? DISCRETE_NOISE_PERIODS[1] : DISCRETE_NOISE_PERIODS[2];
    return {
      frequency,
      frequencyMode: {
        kind: "continuous",
        frequency,
        period
      }
    };
  }
  var sn76489Core = {
    chipModel: "sn76489",
    decodeEnvelopeGain(level) {
      const clamped = clampNibble2(level);
      if (clamped >= 15) {
        return 0;
      }
      return 10 ** (-(clamped * DB_PER_STEP2) / 20);
    },
    decodeAmplitude(volume) {
      const clamped = clampNibble2(volume);
      if (clamped === 0) {
        return 0;
      }
      const attenuationSteps = 15 - clamped;
      return 10 ** (-(attenuationSteps * DB_PER_STEP2) / 20);
    },
    toneOutputLevel() {
      return 0.12;
    },
    noiseOutputLevel() {
      return 0.1;
    },
    tonePeriodFromFrequency(frequency) {
      if (frequency <= 0) {
        return 0;
      }
      return clampPeriod2(MASTER_CLOCK_HZ2 / (TONE_DIVIDER2 * frequency), MAX_TONE_PERIOD2);
    },
    toneFrequencyFromPeriod(period) {
      if (period <= 0) {
        return 0;
      }
      return MASTER_CLOCK_HZ2 / (TONE_DIVIDER2 * clampPeriod2(period, MAX_TONE_PERIOD2));
    },
    noisePeriodFromFrequency(frequency) {
      if (frequency <= 0) {
        return 0;
      }
      return clampPeriod2(MASTER_CLOCK_HZ2 / (NOISE_DIVIDER2 * frequency), MAX_NOISE_PERIOD2);
    },
    noiseFrequencyFromPeriod(period) {
      if (period <= 0) {
        return 0;
      }
      return MASTER_CLOCK_HZ2 / (NOISE_DIVIDER2 * clampPeriod2(period, MAX_NOISE_PERIOD2));
    },
    resolveNoiseFrequencyMode(targetFrequency, tone2Frequency) {
      return discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
    },
    renderToneSample(phase) {
      return phase < 0.5 ? 1 : -1;
    },
    periodicNoiseFeedbackBit(lfsr) {
      return lfsr & 1;
    },
    whiteNoiseFeedbackBit(lfsr) {
      return (lfsr ^ lfsr >> 1) & 1;
    }
  };

  // src/chips/index.ts
  var CHIP_CORES = {
    sn76489: sn76489Core,
    ay38910: ay38910Core
  };
  function getPsgChipCore(chipModel) {
    return CHIP_CORES[chipModel] ?? sn76489Core;
  }

  // src/song-runtime.ts
  var MkvdrvSongRuntime = class _MkvdrvSongRuntime {
    constructor(sampleRateValue) {
      this.sampleRateValue = sampleRateValue;
      this.samplesPerTick = sampleRateValue / 192;
      this.tickSamplesRemaining = this.samplesPerTick;
      this.noiseChannel = this.createNoiseChannel();
      this.resetChannels();
    }
    static EVENT_NOTE_ON = 1;
    static EVENT_NOTE_OFF = 2;
    static EVENT_TEMPO = 3;
    static EVENT_VOLUME = 4;
    static EVENT_NOISE_ON = 5;
    static EVENT_NOISE_OFF = 6;
    static EVENT_ENVELOPE_SELECT = 7;
    static EVENT_PAN = 8;
    static EVENT_PITCH_ENVELOPE_SELECT = 9;
    static PSG_TONE_CHANNELS = 3;
    static PSG_NOISE_CHANNEL = 3;
    static PSG_NOISE_MODE_PERIODIC = 0;
    static PSG_NOISE_MODE_WHITE = 1;
    static PSG_PAN_RIGHT = 1;
    static PSG_PAN_LEFT = 2;
    static PSG_PAN_BOTH = 3;
    wavetable = new Float32Array([0]);
    noteFrequencies = new Float32Array(128);
    renderEngine = "psg";
    chipModel = "sn76489";
    sequenceEvents = new Uint32Array(0);
    eventStride = 5;
    previewFrequency = 440;
    mode = "idle";
    attackRate = 35e-4;
    releaseRate = 18e-4;
    bpm = 124;
    ticksPerBeat = 96;
    loopCount = 0;
    loopsRemaining = 0;
    tailTicks = 0;
    sequenceIndex = 0;
    pendingTerminalAction = "none";
    eventSamplesRemaining = 0;
    samplesPerTick;
    tickSamplesRemaining;
    masterVolume = 1;
    envelopes = /* @__PURE__ */ new Map();
    pitchEnvelopes = /* @__PURE__ */ new Map();
    toneChannels = [];
    noiseChannel;
    sn76489Registers = createSn76489RegisterState();
    get chipCore() {
      return getPsgChipCore(this.chipModel);
    }
    configure({
      renderEngine,
      chipModel,
      wavetable,
      noteFrequencies,
      frequency
    }) {
      this.renderEngine = renderEngine;
      this.chipModel = chipModel;
      this.wavetable = new Float32Array(wavetable);
      this.noteFrequencies = new Float32Array(noteFrequencies);
      this.previewFrequency = frequency;
      this.resetChannels();
      this.configureTonePreviewVoices(frequency);
      return `AudioWorklet ready.
Renderer: ${this.renderEngine}
Chip: ${this.chipModel}
Frequency: ${this.previewFrequency.toFixed(0)} Hz`;
    }
    startTone() {
      this.mode = "tone";
      this.configureTonePreviewVoices(this.previewFrequency);
    }
    loadSequence(payload) {
      this.mode = "sequence";
      this.chipModel = payload.chipModel;
      this.bpm = payload.bpm;
      this.ticksPerBeat = payload.ticksPerBeat;
      this.loopCount = payload.loopCount;
      this.loopsRemaining = this.loopCount < 0 ? -1 : Math.max(0, this.loopCount);
      this.tailTicks = payload.tailTicks;
      this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
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
      return `Sequence ready.
Chip: ${this.chipModel}
Tempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}, loop: ${this.loopCount}`;
    }
    stop() {
      this.mode = "idle";
      this.silenceAllChannels();
    }
    setFrequency(frequency) {
      this.previewFrequency = frequency;
      if (this.mode === "tone") {
        this.configureTonePreviewVoices(frequency);
        return `Tone frequency: ${this.previewFrequency.toFixed(0)} Hz`;
      }
      return void 0;
    }
    setTempo(bpm) {
      this.bpm = bpm;
      this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
      if (this.mode === "sequence") {
        return `Sequence tempo: ${this.bpm.toFixed(0)} BPM`;
      }
      return void 0;
    }
    setMasterVolume(volume) {
      this.masterVolume = Math.max(0, Math.min(1, volume));
      return `Master volume: ${(this.masterVolume * 100).toFixed(0)}%`;
    }
    process(outputs) {
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
          (channel) => channel.frequency > 0 || channel.amplitude >= 1e-4 || channel.targetAmplitude > 0
        );
        const hasActiveNoise = this.noiseChannel.frequency > 0 || this.noiseChannel.amplitude >= 1e-4 || this.noiseChannel.targetAmplitude > 0;
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
    createToneChannel() {
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
        panMask: _MkvdrvSongRuntime.PSG_PAN_BOTH,
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
    createNoiseChannel() {
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
        noiseControlRegister: _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
        amplitude: 0,
        targetAmplitude: 0,
        lfsr: 16384,
        output: 1,
        mode: _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
        baseAmplitude: 0,
        panMask: _MkvdrvSongRuntime.PSG_PAN_BOTH,
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
    resetChannels() {
      this.toneChannels = Array.from(
        { length: _MkvdrvSongRuntime.PSG_TONE_CHANNELS },
        () => this.createToneChannel()
      );
      this.noiseChannel = this.createNoiseChannel();
      this.sn76489Registers = createSn76489RegisterState();
    }
    silenceAllChannels() {
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
      this.noiseChannel.noiseControlRegister = _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE;
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
    }
    normalizeVolumeRegister(value) {
      return Math.max(0, Math.min(15, Math.round(value)));
    }
    applyToneVolumeRegister(channel, value) {
      channel.volumeRegister = this.normalizeVolumeRegister(value);
      channel.baseAmplitude = this.decodePsgAmplitude(channel.volumeRegister);
    }
    applyNoiseVolumeRegister(value) {
      this.noiseChannel.volumeRegister = this.normalizeVolumeRegister(value);
      this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(
        this.noiseChannel.volumeRegister
      );
    }
    setToneChannel(channelIndex, frequency, volumeRegister, restartEnvelope = false) {
      const channel = this.toneChannels[channelIndex];
      if (!channel) {
        return;
      }
      channel.baseFrequency = frequency;
      channel.baseTonePeriod = this.chipCore.tonePeriodFromFrequency(frequency);
      if (this.chipModel === "sn76489" && channelIndex <= 2) {
        this.sn76489Registers = writeSn76489TonePeriod(
          this.sn76489Registers,
          channelIndex,
          channel.baseTonePeriod
        );
        this.sn76489Registers = writeSn76489Volume(
          this.sn76489Registers,
          channelIndex,
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
    setNoiseChannel(frequency, volumeRegister, mode, restartEnvelope = false) {
      this.noiseChannel.baseFrequency = frequency;
      this.applyNoiseVolumeRegister(volumeRegister);
      if (this.chipModel === "sn76489") {
        const tone2Frequency = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
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
      if (mode !== void 0) {
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
        this.noiseChannel.lfsr = 16384;
        this.noiseChannel.output = 1;
      }
    }
    decodeEnvelopeGain(level) {
      return this.chipCore.decodeEnvelopeGain(level);
    }
    refreshToneTarget(channel) {
      channel.targetAmplitude = channel.baseAmplitude * channel.envelopeGain;
    }
    applyPitchOffset(baseFrequency, offset) {
      if (baseFrequency <= 0 || offset === 0) {
        return baseFrequency;
      }
      return baseFrequency * 2 ** (offset / 1200);
    }
    refreshToneFrequency(channel) {
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
    refreshNoiseFrequency() {
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
      const tone2Frequency = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
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
        this.noiseChannel.baseNoisePeriod = resolved.frequencyMode.kind === "continuous" ? resolved.frequencyMode.period : 0;
        this.noiseChannel.noisePeriod = resolved.frequencyMode.kind === "continuous" ? resolved.frequencyMode.period : this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
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
        this.noiseChannel.noisePeriod = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
        this.noiseChannel.frequency = tone2Frequency;
        return;
      }
      this.noiseChannel.baseNoisePeriod = frequencyMode.period;
      this.noiseChannel.noisePeriod = frequencyMode.period;
      this.noiseChannel.frequency = frequencyMode.frequency;
    }
    refreshNoiseTarget() {
      this.noiseChannel.targetAmplitude = this.noiseChannel.baseAmplitude * this.noiseChannel.envelopeGain;
    }
    restartToneEnvelope(channel) {
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
    restartNoiseEnvelope() {
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
    restartTonePitchEnvelope(channel) {
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
    restartNoisePitchEnvelope() {
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
    advanceChannelEnvelope(channel) {
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
      if (envelope.loopStart !== void 0 && envelope.loopStart < envelope.values.length) {
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
    advanceTonePitchEnvelope(channel) {
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
    advanceNoisePitchEnvelope() {
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
    advanceEnvelopeTick() {
      this.toneChannels.forEach((channel) => {
        this.advanceChannelEnvelope(channel);
        this.advanceTonePitchEnvelope(channel);
        this.refreshToneTarget(channel);
      });
      this.advanceChannelEnvelope(this.noiseChannel);
      this.advanceNoisePitchEnvelope();
      this.refreshNoiseTarget();
    }
    decodePsgAmplitude(volume) {
      return this.chipCore.decodeAmplitude(volume);
    }
    decodeNoiseParam(param) {
      if (param > 255) {
        return {
          volume: param & 255,
          mode: param >>> 8 & 255
        };
      }
      return {
        volume: Math.max(0, Math.min(15, param)),
        mode: _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE
      };
    }
    normalizePanMask(panMask) {
      return panMask & _MkvdrvSongRuntime.PSG_PAN_BOTH;
    }
    applyPanLevel(panMask, sample) {
      const normalized = this.normalizePanMask(panMask);
      return {
        left: (normalized & _MkvdrvSongRuntime.PSG_PAN_LEFT) !== 0 ? sample : 0,
        right: (normalized & _MkvdrvSongRuntime.PSG_PAN_RIGHT) !== 0 ? sample : 0
      };
    }
    configureTonePreviewVoices(frequency) {
      const previewFrequencies = [frequency, frequency * 1.5, frequency * 2];
      this.toneChannels.forEach((channel, index) => {
        channel.baseFrequency = previewFrequencies[index] ?? frequency;
        channel.baseTonePeriod = this.chipCore.tonePeriodFromFrequency(
          channel.baseFrequency
        );
        this.applyToneVolumeRegister(channel, 15);
        channel.panMask = _MkvdrvSongRuntime.PSG_PAN_BOTH;
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
      this.noiseChannel.noiseControlRegister = _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE;
      this.noiseChannel.baseAmplitude = 0;
      this.noiseChannel.targetAmplitude = 0;
      this.noiseChannel.panMask = _MkvdrvSongRuntime.PSG_PAN_BOTH;
      this.noiseChannel.pitchEnvelopeId = 0;
      this.noiseChannel.pitchOffset = 0;
      this.noiseChannel.pitchActive = false;
    }
    advanceSequenceEvent() {
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
      if (eventKind === _MkvdrvSongRuntime.EVENT_NOTE_ON) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          this.setToneChannel(
            channel,
            this.noteFrequencies[value] ?? 0,
            param,
            true
          );
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOTE_OFF) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          this.setToneChannel(channel, 0, 0);
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.setNoiseChannel(0, 0);
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_TEMPO) {
        this.bpm = value;
        this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_VOLUME) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            this.applyToneVolumeRegister(toneChannel, value);
            this.refreshToneTarget(toneChannel);
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.applyNoiseVolumeRegister(value);
          this.noiseChannel.mode = param;
          this.noiseChannel.noiseControlRegister = param;
          this.refreshNoiseTarget();
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_ENVELOPE_SELECT) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.envelopeId = value;
            if (toneChannel.frequency > 0 || toneChannel.baseAmplitude > 0) {
              this.restartToneEnvelope(toneChannel);
              this.refreshToneTarget(toneChannel);
            }
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.envelopeId = value;
          if (this.noiseChannel.frequency > 0 || this.noiseChannel.baseAmplitude > 0) {
            this.restartNoiseEnvelope();
            this.refreshNoiseTarget();
          }
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_PITCH_ENVELOPE_SELECT) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.pitchEnvelopeId = value;
            if (toneChannel.baseFrequency > 0) {
              this.restartTonePitchEnvelope(toneChannel);
            }
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.pitchEnvelopeId = value;
          if (this.noiseChannel.baseFrequency > 0) {
            this.restartNoisePitchEnvelope();
          }
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_PAN) {
        const panMask = this.normalizePanMask(value);
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.panMask = panMask;
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.panMask = panMask;
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOISE_ON) {
        this.setNoiseChannel(
          value,
          noiseSettings.volume,
          noiseSettings.mode,
          true
        );
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOISE_OFF) {
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
    resolvePendingTerminalAction() {
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
    readUpcomingEventDelaySamples() {
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
          60 / this.bpm / this.ticksPerBeat * this.sampleRateValue * deltaTicks
        )
      );
    }
    readTailDelaySamples() {
      if (this.tailTicks <= 0) {
        return 0;
      }
      return Math.max(
        1,
        Math.round(
          60 / this.bpm / this.ticksPerBeat * this.sampleRateValue * this.tailTicks
        )
      );
    }
    updateEnvelope(current, target) {
      const rate = target > current ? this.attackRate : this.releaseRate;
      return current + (target - current) * rate;
    }
    syncNoiseFromTone2() {
      if (this.noiseChannel.frequencyMode.kind !== "tone2") {
        return;
      }
      const tone2 = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1];
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
    renderSineChannel(channel) {
      const tableLength = this.wavetable.length;
      const phaseStep = channel.frequency * tableLength / this.sampleRateValue;
      const tableIndex = Math.floor(channel.phase) % tableLength;
      const nextIndex = (tableIndex + 1) % tableLength;
      const fraction = channel.phase - tableIndex;
      const sample = this.wavetable[tableIndex] * (1 - fraction) + this.wavetable[nextIndex] * fraction;
      channel.phase += phaseStep;
      if (channel.phase >= tableLength) {
        channel.phase -= tableLength;
      }
      return sample;
    }
    renderPsgToneChannel(channel) {
      const phaseStep = channel.frequency / this.sampleRateValue;
      const cyclePhase = channel.phase - Math.floor(channel.phase);
      const sample = this.chipCore.renderToneSample(cyclePhase);
      channel.phase += phaseStep;
      if (channel.phase >= 1) {
        channel.phase -= Math.floor(channel.phase);
      }
      return sample;
    }
    renderNoiseChannel() {
      if (this.noiseChannel.frequency <= 0 && this.noiseChannel.amplitude < 1e-4 && this.noiseChannel.targetAmplitude <= 0) {
        return 0;
      }
      const phaseStep = Math.max(1, this.noiseChannel.frequency) / this.sampleRateValue;
      this.noiseChannel.phase += phaseStep;
      while (this.noiseChannel.phase >= 1) {
        const feedbackBit = this.noiseChannel.mode === _MkvdrvSongRuntime.PSG_NOISE_MODE_PERIODIC ? this.periodicNoiseFeedbackBit() : this.whiteNoiseFeedbackBit();
        const feedback = feedbackBit << 14;
        this.noiseChannel.lfsr = this.noiseChannel.lfsr >> 1 | feedback;
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
    periodicNoiseFeedbackBit() {
      return this.chipCore.periodicNoiseFeedbackBit(this.noiseChannel.lfsr);
    }
    whiteNoiseFeedbackBit() {
      return this.chipCore.whiteNoiseFeedbackBit(this.noiseChannel.lfsr);
    }
    renderMixedFrame() {
      let left = 0;
      let right = 0;
      this.toneChannels.forEach((channel) => {
        channel.amplitude = this.updateEnvelope(
          channel.amplitude,
          channel.targetAmplitude
        );
        if (channel.frequency <= 0 || channel.amplitude < 1e-4) {
          return;
        }
        const sample = this.renderEngine === "psg" ? this.renderPsgToneChannel(channel) : this.renderSineChannel(channel);
        const outputLevel = this.renderEngine === "psg" ? this.chipCore.toneOutputLevel() : 0.22;
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
  };

  // src/processor.ts
  var MkvdrvProcessor = class extends AudioWorkletProcessor {
    runtime = new MkvdrvSongRuntime(sampleRate);
    constructor() {
      super();
      this.port.onmessage = (event) => {
        const message = event.data;
        if (message.type === "configure") {
          this.port.postMessage(
            this.runtime.configure({
              renderEngine: message.renderEngine,
              chipModel: message.chipModel,
              wavetable: message.wavetable,
              noteFrequencies: message.noteFrequencies,
              frequency: message.frequency
            })
          );
          return;
        }
        if (message.type === "startTone") {
          this.runtime.startTone();
          return;
        }
        if (message.type === "startSequence") {
          this.port.postMessage(
            this.runtime.loadSequence({
              bpm: message.bpm,
              ticksPerBeat: message.ticksPerBeat,
              loopCount: message.loopCount,
              tailTicks: message.tailTicks,
              chipModel: message.chipModel,
              sequenceEvents: message.sequenceEvents,
              eventStride: message.eventStride,
              envelopes: message.envelopes,
              pitchEnvelopes: message.pitchEnvelopes
            })
          );
          return;
        }
        if (message.type === "stop") {
          this.runtime.stop();
          return;
        }
        if (message.type === "setFrequency") {
          const log = this.runtime.setFrequency(message.frequency);
          if (log) {
            this.port.postMessage(log);
          }
          return;
        }
        if (message.type === "setTempo") {
          const log = this.runtime.setTempo(message.bpm);
          if (log) {
            this.port.postMessage(log);
          }
          return;
        }
        if (message.type === "setMasterVolume") {
          this.port.postMessage(this.runtime.setMasterVolume(message.volume));
        }
      };
    }
    process(inputs, outputs) {
      void inputs;
      return this.runtime.process(outputs);
    }
  };
  registerProcessor("mkvdrv-processor", MkvdrvProcessor);
})();
