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
  function clampMixerMask(mask) {
    return Math.max(0, Math.min(7, Math.round(mask))) & 7;
  }
  function clampEnvelopeShape(shape) {
    return Math.max(0, Math.min(15, Math.round(shape))) & 15;
  }
  function clampChannelVolume(level) {
    return clampNibble(level);
  }
  function createAy38910RegisterState() {
    return {
      tonePeriods: [0, 0, 0],
      channelVolumes: [
        { level: 0, usesHardwareEnvelope: false },
        { level: 0, usesHardwareEnvelope: false },
        { level: 0, usesHardwareEnvelope: false }
      ],
      noisePeriod: 0,
      mixerToneMask: 7,
      mixerNoiseMask: 7,
      envelopePeriod: 512,
      envelopeShape: 9
    };
  }
  function writeAy38910TonePeriod(state, channel, period) {
    const next = {
      ...state,
      tonePeriods: [...state.tonePeriods]
    };
    next.tonePeriods[channel] = period <= 0 ? 0 : clampPeriod(period, MAX_TONE_PERIOD);
    return next;
  }
  function writeAy38910ChannelVolume(state, channel, level, usesHardwareEnvelope) {
    const next = {
      ...state,
      channelVolumes: state.channelVolumes.map((volumeState) => ({ ...volumeState }))
    };
    next.channelVolumes[channel] = {
      level: clampChannelVolume(level),
      usesHardwareEnvelope
    };
    return next;
  }
  function writeAy38910NoisePeriod(state, period) {
    return {
      ...state,
      noisePeriod: period <= 0 ? 0 : clampPeriod(period, MAX_NOISE_PERIOD)
    };
  }
  function writeAy38910MixerToneMask(state, mask) {
    return {
      ...state,
      mixerToneMask: clampMixerMask(mask)
    };
  }
  function writeAy38910MixerNoiseMask(state, mask) {
    return {
      ...state,
      mixerNoiseMask: clampMixerMask(mask)
    };
  }
  function writeAy38910EnvelopePeriod(state, period) {
    return {
      ...state,
      envelopePeriod: Math.max(1, Math.round(period))
    };
  }
  function writeAy38910EnvelopeShape(state, shape) {
    return {
      ...state,
      envelopeShape: clampEnvelopeShape(shape)
    };
  }
  function resolveAy38910ToneEnabled(state, channel) {
    return (state.mixerToneMask & 1 << channel) !== 0;
  }
  function resolveAy38910NoiseEnabled(state, channel) {
    return (state.mixerNoiseMask & 1 << channel) !== 0;
  }
  function resolveAy38910ChannelGain(state, channel, decodeAmplitude, hardwareEnvelopeGain) {
    const volumeState = state.channelVolumes[channel];
    if (!volumeState) {
      return 0;
    }
    if (volumeState.usesHardwareEnvelope) {
      return Math.max(0, Math.min(1, hardwareEnvelopeGain));
    }
    return decodeAmplitude(volumeState.level);
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
    toneClockStep(sampleRate2) {
      return MASTER_CLOCK_HZ / TONE_DIVIDER / sampleRate2;
    },
    noiseClockStep(sampleRate2) {
      return MASTER_CLOCK_HZ / NOISE_DIVIDER / sampleRate2;
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
  var RENDER_CLOCK_DIVIDER = 16;
  var MIN_PERIOD2 = 1;
  var MAX_TONE_PERIOD2 = 1023;
  var MAX_NOISE_PERIOD2 = 1023;
  var DISCRETE_NOISE_PERIODS = [16, 32, 64];
  var SN76489_LFSR_RESET = 16384;
  var SN76489_LFSR_MASK = 32767;
  var SN76489_ENVELOPE_GAIN_TABLE = Array.from(
    { length: 16 },
    (_, level) => level >= 15 ? 0 : 10 ** (-(level * DB_PER_STEP2) / 20)
  );
  var SN76489_VOLUME_TABLE = Array.from(
    { length: 16 },
    (_, level) => level <= 0 ? 0 : SN76489_ENVELOPE_GAIN_TABLE[15 - level] ?? 0
  );
  function clampNibble2(value) {
    return Math.max(0, Math.min(15, value));
  }
  function clampPeriod2(value, max) {
    return Math.max(MIN_PERIOD2, Math.min(max, Math.round(value)));
  }
  function cloneRegisterState(state) {
    return {
      ...state,
      tonePeriods: [...state.tonePeriods],
      volumeRegisters: [...state.volumeRegisters]
    };
  }
  function decomposeSn76489TonePeriodWrite(channel, period) {
    const normalized = clampPeriod2(period, MAX_TONE_PERIOD2);
    const register = channel * 2;
    return [
      {
        kind: "latchTone",
        register,
        value: normalized & 15
      },
      {
        kind: "dataTone",
        register,
        value: normalized >> 4 & 63
      }
    ];
  }
  function decomposeSn76489VolumeWrite(channel, volume) {
    return [
      {
        kind: "latchVolume",
        register: channel * 2 + 1,
        value: clampNibble2(volume)
      }
    ];
  }
  function decomposeSn76489NoiseControlWriteStep(resolvedSource, noiseMode) {
    const sourceBits = resolvedSource === "clock_div_512" ? 0 : resolvedSource === "clock_div_1024" ? 1 : resolvedSource === "clock_div_2048" ? 2 : 3;
    return {
      kind: "latchNoise",
      register: 6,
      value: (noiseMode & 1) << 2 | sourceBits
    };
  }
  function applySn76489WriteStep(state, step) {
    const next = cloneRegisterState(state);
    if (step.kind === "latchTone") {
      const channel = step.register / 2;
      const previous = next.tonePeriods[channel] & 1008;
      next.tonePeriods[channel] = previous | step.value & 15;
      next.latchedRegister = step.register;
      return next;
    }
    if (step.kind === "dataTone") {
      const channel = step.register / 2;
      const previous = next.tonePeriods[channel] & 15;
      next.tonePeriods[channel] = previous | (step.value & 63) << 4;
      next.latchedRegister = step.register;
      return next;
    }
    if (step.kind === "latchVolume") {
      const channel = (step.register - 1) / 2;
      next.volumeRegisters[channel] = step.value & 15;
      next.latchedRegister = step.register;
      return next;
    }
    const sourceBits = step.value & 3;
    next.noiseMode = step.value >> 2 & 1;
    next.noiseSource = sourceBits === 0 ? "clock_div_512" : sourceBits === 1 ? "clock_div_1024" : sourceBits === 2 ? "clock_div_2048" : "tone2";
    next.latchedRegister = 6;
    return next;
  }
  function resetSn76489Lfsr() {
    return SN76489_LFSR_RESET;
  }
  function shiftSn76489Lfsr(lfsr, noiseMode) {
    const normalized = lfsr & SN76489_LFSR_MASK || SN76489_LFSR_RESET;
    const feedbackBit = noiseMode === 0 ? periodicFeedbackBit(normalized) : whiteFeedbackBit(normalized);
    const nextLfsr = (normalized >> 1 | feedbackBit << 14) & SN76489_LFSR_MASK;
    return {
      lfsr: nextLfsr || SN76489_LFSR_RESET,
      output: (nextLfsr & 1) !== 0 ? 1 : -1
    };
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
    const [latchStep, dataStep] = decomposeSn76489TonePeriodWrite(channel, period);
    return applySn76489WriteStep(applySn76489WriteStep(state, latchStep), dataStep);
  }
  function writeSn76489Volume(state, channel, volume) {
    const [step] = decomposeSn76489VolumeWrite(channel, volume);
    return applySn76489WriteStep(state, step);
  }
  function writeSn76489NoiseControl(state, targetFrequency, tone2Frequency, noiseMode) {
    const resolved = discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
    const next = {
      ...cloneRegisterState(state),
      latchedRegister: 6
    };
    const previousMode = state.noiseMode;
    const previousSource = state.noiseSource;
    next.noiseMode = noiseMode;
    if (resolved.kind === "tone2") {
      const step2 = decomposeSn76489NoiseControlWriteStep("tone2", noiseMode);
      const applied2 = applySn76489WriteStep(next, step2);
      const modeChanged2 = previousMode !== next.noiseMode;
      const sourceChanged2 = previousSource !== applied2.noiseSource;
      const controlChanged2 = modeChanged2 || sourceChanged2;
      return {
        state: applied2,
        controlChanged: controlChanged2,
        sourceChanged: sourceChanged2,
        modeChanged: modeChanged2,
        resetReason: controlChanged2 ? modeChanged2 && sourceChanged2 ? "mode+source" : modeChanged2 ? "mode" : "source" : "none",
        resetLfsr: controlChanged2,
        reloadCounter: sourceChanged2
      };
    }
    const step = decomposeSn76489NoiseControlWriteStep(
      sourceForDiscretePeriod(resolved.period),
      noiseMode
    );
    const applied = applySn76489WriteStep(next, step);
    const modeChanged = previousMode !== applied.noiseMode;
    const sourceChanged = previousSource !== applied.noiseSource;
    const controlChanged = modeChanged || sourceChanged;
    return {
      state: applied,
      controlChanged,
      sourceChanged,
      modeChanged,
      resetReason: controlChanged ? modeChanged && sourceChanged ? "mode+source" : modeChanged ? "mode" : "source" : "none",
      resetLfsr: controlChanged,
      reloadCounter: sourceChanged
    };
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
      return SN76489_ENVELOPE_GAIN_TABLE[clampNibble2(level)] ?? 0;
    },
    decodeAmplitude(volume) {
      return SN76489_VOLUME_TABLE[clampNibble2(volume)] ?? 0;
    },
    toneOutputLevel() {
      return 0.12;
    },
    noiseOutputLevel() {
      return 0.1;
    },
    toneClockStep(sampleRate2) {
      return MASTER_CLOCK_HZ2 / RENDER_CLOCK_DIVIDER / sampleRate2;
    },
    noiseClockStep(sampleRate2) {
      return MASTER_CLOCK_HZ2 / RENDER_CLOCK_DIVIDER / sampleRate2;
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
      return periodicFeedbackBit(lfsr);
    },
    whiteNoiseFeedbackBit(lfsr) {
      return whiteFeedbackBit(lfsr);
    }
  };
  function periodicFeedbackBit(lfsr) {
    return lfsr & 1;
  }
  function whiteFeedbackBit(lfsr) {
    return (lfsr ^ lfsr >> 1) & 1;
  }

  // src/chips/index.ts
  var CHIP_CORES = {
    sn76489: sn76489Core,
    ay38910: ay38910Core
  };
  function getPsgChipCore(chipModel) {
    return CHIP_CORES[chipModel] ?? sn76489Core;
  }

  // src/song-runtime.ts
  var PRESET_ENVELOPE_ID_BASE = 32768;
  var AY_MASTER_CLOCK_HZ = 1789773;
  var AY_HARDWARE_ENVELOPE_DIVIDER = 256;
  var AY_PRESET_ENVELOPES = {
    32769: { id: 32769, speed: 1, values: [1] },
    32770: { id: 32770, speed: 1, values: [5] },
    32771: { id: 32771, speed: 1, values: [13, 9, 5, 1] },
    32772: { id: 32772, speed: 2, values: [15, 13, 11, 9, 7, 5, 3, 1] },
    32773: { id: 32773, speed: 1, values: [1, 5, 9, 12, 15] },
    32774: { id: 32774, speed: 2, values: [1, 3, 5, 7, 9, 11, 13, 14, 15] },
    32775: { id: 32775, speed: 1, values: [1, 4, 7, 9, 9, 9, 9] },
    32776: { id: 32776, speed: 1, values: [1, 9, 1] },
    32777: { id: 32777, speed: 1, values: [1, 11, 5, 1] }
  };
  function isPresetEnvelopeId(envelopeId) {
    return envelopeId > PRESET_ENVELOPE_ID_BASE && envelopeId < PRESET_ENVELOPE_ID_BASE + 10;
  }
  function envelopeMapForChipModel(chipModel, envelopes) {
    const map = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    if (chipModel !== "ay38910") {
      return map;
    }
    for (const [id, envelope] of Object.entries(AY_PRESET_ENVELOPES)) {
      map.set(Number(id), envelope);
    }
    return map;
  }
  function parseAyHardwareEnvelopeShape(shape) {
    const normalized = Math.max(0, Math.min(15, Math.round(shape))) & 15;
    return {
      continueFlag: (normalized & 8) !== 0,
      attack: (normalized & 4) !== 0,
      alternate: (normalized & 2) !== 0,
      hold: (normalized & 1) !== 0
    };
  }
  function resolveAyHardwareEnvelopeCycleEnd(state) {
    if (!state.continueFlag) {
      return {
        step: 0,
        direction: state.direction,
        holding: true
      };
    }
    const nextDirection = state.alternate ? state.direction === 1 ? -1 : 1 : state.direction;
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
  function traceAyHardwareEnvelopeSteps(shape, stepsToCollect = 20) {
    const flags = parseAyHardwareEnvelopeShape(shape);
    let step = flags.attack ? 0 : 15;
    let direction = flags.attack ? 1 : -1;
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
  var MkvdrvSongRuntime = class _MkvdrvSongRuntime {
    constructor(sampleRateValue) {
      this.sampleRateValue = sampleRateValue;
      this.samplesPerTick = sampleRateValue / 192;
      this.tickSamplesRemaining = this.samplesPerTick;
      this.noiseChannel = this.createNoiseChannel();
      this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
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
    static EVENT_AY_HARDWARE_ENVELOPE_SHAPE = 10;
    static EVENT_AY_HARDWARE_ENVELOPE_PERIOD = 11;
    static EVENT_AY_HARDWARE_ENVELOPE_ENABLE = 12;
    static EVENT_AY_MIXER_TONE_MASK = 13;
    static EVENT_AY_MIXER_NOISE_MASK = 14;
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
    ayHardwareEnvelope;
    ay38910Registers = createAy38910RegisterState();
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
      return `Sequence ready.
Chip: ${this.chipModel}
Tempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}, loop: ${this.loopCount}${ayDebug}${snDebug}`;
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
    describeAyHardwareEnvelopeDebug() {
      if (this.chipModel !== "ay38910") {
        return "";
      }
      const summaries = [];
      let currentPeriod = this.ayHardwareEnvelope.period;
      for (let index = 0; index < this.sequenceEvents.length; index += this.eventStride) {
        const kind = this.sequenceEvents[index];
        const value = this.sequenceEvents[index + 1] ?? 0;
        if (kind === _MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_PERIOD) {
          currentPeriod = value;
          continue;
        }
        if (kind !== _MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_SHAPE) {
          continue;
        }
        const shape = value & 15;
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
      return `
AY HW trace:
${summaries.join("\n")}`;
    }
    describeSn76489WriteTrace() {
      if (this.chipModel !== "sn76489" || this.sequenceEvents.length === 0) {
        return "";
      }
      let traceState = createSn76489RegisterState();
      const lines = [];
      const pushTraceLine = (eventIndex, target, updateKind, resetReason, write, detail = "") => {
        lines.push(
          `#${eventIndex} | ${target} | kind=${updateKind} | reset=${resetReason} | write=${write} | detail=${detail}`
        );
      };
      for (let eventIndex = 0; eventIndex < this.sequenceEvents.length / this.eventStride; eventIndex += 1) {
        const base = eventIndex * this.eventStride;
        const eventKind = this.sequenceEvents[base];
        const value = this.sequenceEvents[base + 1] ?? 0;
        const channel = this.sequenceEvents[base + 3] ?? 0;
        const param = this.sequenceEvents[base + 4] ?? 0;
        const noiseSettings = this.decodeNoiseParam(param);
        if (eventKind === _MkvdrvSongRuntime.EVENT_NOTE_ON && channel < 3) {
          const frequency = this.noteFrequencies[value] ?? 0;
          const period = this.chipCore.tonePeriodFromFrequency(frequency);
          const [latchStep, dataStep] = decomposeSn76489TonePeriodWrite(
            channel,
            period
          );
          const [volumeStep] = decomposeSn76489VolumeWrite(
            channel,
            param
          );
          traceState = writeSn76489TonePeriod(
            traceState,
            channel,
            period
          );
          traceState = writeSn76489Volume(
            traceState,
            channel,
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
        if (eventKind === _MkvdrvSongRuntime.EVENT_VOLUME && channel < 3) {
          const [volumeStep] = decomposeSn76489VolumeWrite(
            channel,
            value
          );
          traceState = writeSn76489Volume(
            traceState,
            channel,
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
        if (eventKind === _MkvdrvSongRuntime.EVENT_NOISE_ON) {
          const tone2Period = traceState.tonePeriods[2] ?? 0;
          const tone2Frequency = tone2Period > 0 ? this.chipCore.toneFrequencyFromPeriod(tone2Period) : 0;
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
        if (eventKind === _MkvdrvSongRuntime.EVENT_VOLUME && channel === 3) {
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
      const suffix = lines.length > previewLines.length ? `
... (${lines.length - previewLines.length} more writes)` : "";
      return `
SN write trace:
${previewLines.join("\n")}${suffix}`;
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
        envelopeActive: false,
        ayHardwareEnvelopeEnabled: false
      };
    }
    createNoiseChannel() {
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
        envelopeActive: false,
        lastResetReason: "none",
        ayHardwareEnvelopeEnabled: false
      };
    }
    createAyHardwareEnvelope() {
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
    resetChannels() {
      this.toneChannels = Array.from(
        { length: _MkvdrvSongRuntime.PSG_TONE_CHANNELS },
        () => this.createToneChannel()
      );
      this.noiseChannel = this.createNoiseChannel();
      this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
      this.ay38910Registers = createAy38910RegisterState();
      this.sn76489Registers = createSn76489RegisterState();
    }
    silenceAllChannels() {
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
      this.noiseChannel.noiseControlRegister = _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE;
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
      this.noiseChannel.lastResetReason = "none";
      this.noiseChannel.ayHardwareEnvelopeEnabled = false;
      this.ayHardwareEnvelope = this.createAyHardwareEnvelope();
      this.ay38910Registers = createAy38910RegisterState();
    }
    normalizeVolumeRegister(value) {
      return Math.max(0, Math.min(15, Math.round(value)));
    }
    syncAyToneRegister(channelIndex, channel) {
      if (this.chipModel !== "ay38910" || channelIndex > 2) {
        return;
      }
      this.ay38910Registers = writeAy38910TonePeriod(
        this.ay38910Registers,
        channelIndex,
        channel.tonePeriod
      );
      this.ay38910Registers = writeAy38910ChannelVolume(
        this.ay38910Registers,
        channelIndex,
        channel.volumeRegister,
        channel.ayHardwareEnvelopeEnabled
      );
    }
    syncAyToneRegisterForChannel(channel) {
      if (this.chipModel !== "ay38910") {
        return;
      }
      const channelIndex = this.toneChannels.indexOf(channel);
      if (channelIndex < 0 || channelIndex >= _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        return;
      }
      this.syncAyToneRegister(channelIndex, channel);
    }
    syncAyNoiseRegister() {
      if (this.chipModel !== "ay38910") {
        return;
      }
      this.ay38910Registers = writeAy38910NoisePeriod(
        this.ay38910Registers,
        this.noiseChannel.baseNoisePeriod
      );
    }
    applyToneVolumeRegister(channel, value, channelIndex) {
      channel.volumeRegister = this.normalizeVolumeRegister(value);
      channel.baseAmplitude = this.chipModel === "ay38910" && channelIndex !== void 0 && channelIndex <= 2 ? resolveAy38910ChannelGain(
        this.ay38910Registers,
        channelIndex,
        (volume) => this.decodePsgAmplitude(volume),
        this.currentAyHardwareEnvelopeGain()
      ) : this.decodePsgAmplitude(channel.volumeRegister);
      if (channelIndex !== void 0) {
        this.syncAyToneRegister(channelIndex, channel);
        if (this.chipModel === "ay38910") {
          channel.baseAmplitude = resolveAy38910ChannelGain(
            this.ay38910Registers,
            channelIndex,
            (volume) => this.decodePsgAmplitude(volume),
            this.currentAyHardwareEnvelopeGain()
          );
        }
      }
    }
    applyNoiseVolumeRegister(value) {
      this.noiseChannel.volumeRegister = this.normalizeVolumeRegister(value);
      this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(
        this.noiseChannel.volumeRegister
      );
    }
    resetSn76489NoiseShiftRegister() {
      this.noiseChannel.lfsr = resetSn76489Lfsr();
      this.noiseChannel.output = 1;
      this.noiseChannel.shiftClockOutput = 0;
      this.noiseChannel.clockAccumulator = 0;
      this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
    }
    applyResolvedSn76489NoiseState(tone2Frequency, resetLfsr, reloadCounter) {
      const resolved = resolveSn76489NoiseState(this.sn76489Registers, tone2Frequency);
      this.noiseChannel.frequencyMode = resolved.frequencyMode;
      this.noiseChannel.baseNoisePeriod = resolved.frequencyMode.kind === "continuous" ? resolved.frequencyMode.period : 0;
      this.noiseChannel.noisePeriod = resolved.frequencyMode.kind === "continuous" ? resolved.frequencyMode.period : this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
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
    applySn76489NoiseControlWrite(targetFrequency, noiseMode) {
      const tone2Frequency = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
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
    applySn76489NoiseControlUpdate(targetFrequency, noiseMode) {
      this.noiseChannel.mode = noiseMode;
      this.noiseChannel.noiseControlRegister = noiseMode;
      this.applySn76489NoiseControlWrite(targetFrequency, noiseMode);
    }
    refreshSn76489NoiseDerivedState() {
      const tone2Frequency = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
      const previousModeKind = this.noiseChannel.frequencyMode.kind;
      const previousPeriod = this.noiseChannel.noisePeriod;
      const previousFrequency = this.noiseChannel.frequency;
      const resolved = resolveSn76489NoiseState(this.sn76489Registers, tone2Frequency);
      const nextPeriod = resolved.frequencyMode.kind === "continuous" ? resolved.frequencyMode.period : this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.tonePeriod ?? 0;
      const derivedStateChanged = previousModeKind !== resolved.frequencyMode.kind || previousPeriod !== nextPeriod || Math.abs(previousFrequency - resolved.frequency) > 1e-4;
      this.applyResolvedSn76489NoiseState(tone2Frequency, false, derivedStateChanged);
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
    setNoiseChannel(frequency, volumeRegister, mode, restartEnvelope = false) {
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
      if (this.chipModel !== "sn76489" && mode !== void 0) {
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
    decodeEnvelopeGain(level) {
      return this.chipCore.decodeEnvelopeGain(level);
    }
    decodeAyHardwareEnvelopeStep(step) {
      const clampedStep = Math.max(0, Math.min(15, Math.round(step)));
      return this.decodeEnvelopeGain(15 - clampedStep);
    }
    currentAyHardwareEnvelopeGain() {
      return Math.max(0, Math.min(1, this.ayHardwareEnvelope.gain));
    }
    resolveToneEnvelopeTarget(channel) {
      if (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
        return this.currentAyHardwareEnvelopeGain();
      }
      return channel.baseAmplitude * channel.envelopeGain;
    }
    resolveNoiseEnvelopeTarget(channel) {
      if (this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
        return this.currentAyHardwareEnvelopeGain();
      }
      return channel.baseAmplitude * channel.envelopeGain;
    }
    refreshToneTarget(channel) {
      channel.targetAmplitude = this.resolveToneEnvelopeTarget(channel);
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
      this.syncAyToneRegisterForChannel(channel);
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
      const tone2Frequency = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1]?.frequency ?? 0;
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
      this.syncAyNoiseRegister();
    }
    refreshNoiseTarget() {
      this.noiseChannel.targetAmplitude = this.resolveNoiseEnvelopeTarget(
        this.noiseChannel
      );
    }
    restartAyHardwareEnvelope() {
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
    applyAyHardwareEnvelopeShape(shape) {
      this.ay38910Registers = writeAy38910EnvelopeShape(this.ay38910Registers, shape);
      this.ayHardwareEnvelope.shape = this.ay38910Registers.envelopeShape;
      this.restartAyHardwareEnvelope();
    }
    applyAyHardwareEnvelopePeriod(period) {
      this.ay38910Registers = writeAy38910EnvelopePeriod(
        this.ay38910Registers,
        period
      );
      this.ayHardwareEnvelope.period = this.ay38910Registers.envelopePeriod;
      this.ayHardwareEnvelope.counter = Math.max(1, this.ayHardwareEnvelope.period);
    }
    applyAyHardwareEnvelopeEnable(channel, enabled) {
      if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
        const toneChannel = this.toneChannels[channel];
        if (!toneChannel) {
          return;
        }
        toneChannel.ayHardwareEnvelopeEnabled = enabled;
        this.syncAyToneRegister(channel, toneChannel);
        toneChannel.baseAmplitude = resolveAy38910ChannelGain(
          this.ay38910Registers,
          channel,
          (volume) => this.decodePsgAmplitude(volume),
          this.currentAyHardwareEnvelopeGain()
        );
        if (enabled) {
          toneChannel.envelopeActive = false;
        }
        this.refreshToneTarget(toneChannel);
        return;
      }
      if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
        this.noiseChannel.ayHardwareEnvelopeEnabled = enabled;
        if (enabled) {
          this.noiseChannel.envelopeActive = false;
        }
        this.refreshNoiseTarget();
      }
    }
    applyAyMixerToneMask(mask) {
      this.ay38910Registers = writeAy38910MixerToneMask(this.ay38910Registers, mask);
    }
    applyAyMixerNoiseMask(mask) {
      this.ay38910Registers = writeAy38910MixerNoiseMask(this.ay38910Registers, mask);
    }
    isAyToneEnabled(channelIndex) {
      return resolveAy38910ToneEnabled(this.ay38910Registers, channelIndex);
    }
    isAyNoiseEnabled(channelIndex) {
      return resolveAy38910NoiseEnabled(this.ay38910Registers, channelIndex);
    }
    refreshAyHardwareEnvelopeTargets() {
      if (this.chipModel !== "ay38910") {
        return;
      }
      this.toneChannels.forEach((channel) => {
        if (channel.ayHardwareEnvelopeEnabled) {
          const channelIndex = this.toneChannels.indexOf(channel);
          if (channelIndex >= 0 && channelIndex < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
            channel.baseAmplitude = resolveAy38910ChannelGain(
              this.ay38910Registers,
              channelIndex,
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
    advanceAyHardwareEnvelopeFrame() {
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
    restartToneEnvelope(channel) {
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
    restartNoiseEnvelope() {
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
      if (!channel.envelopeActive || channel.envelopeId === 0 || this.chipModel === "ay38910" && channel.ayHardwareEnvelopeEnabled) {
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
    resolveEnvelope(envelopeId) {
      const envelope = this.envelopes.get(envelopeId);
      if (envelope) {
        return envelope;
      }
      if (this.chipModel === "ay38910" && isPresetEnvelopeId(envelopeId)) {
        return AY_PRESET_ENVELOPES[envelopeId];
      }
      return void 0;
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
        this.applyToneVolumeRegister(channel, 15, index);
        channel.panMask = _MkvdrvSongRuntime.PSG_PAN_BOTH;
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
            this.applyToneVolumeRegister(toneChannel, value, channel);
            this.refreshToneTarget(toneChannel);
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
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
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_ENVELOPE_SELECT) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.ayHardwareEnvelopeEnabled = false;
            this.syncAyToneRegister(channel, toneChannel);
            toneChannel.baseAmplitude = resolveAy38910ChannelGain(
              this.ay38910Registers,
              channel,
              (volume) => this.decodePsgAmplitude(volume),
              this.currentAyHardwareEnvelopeGain()
            );
            toneChannel.envelopeId = value;
            if (toneChannel.frequency > 0 || toneChannel.baseAmplitude > 0) {
              this.restartToneEnvelope(toneChannel);
              this.refreshToneTarget(toneChannel);
            }
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.ayHardwareEnvelopeEnabled = false;
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
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_SHAPE && this.chipModel === "ay38910") {
        this.applyAyHardwareEnvelopeShape(value);
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_PERIOD && this.chipModel === "ay38910") {
        this.applyAyHardwareEnvelopePeriod(value);
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_AY_HARDWARE_ENVELOPE_ENABLE && this.chipModel === "ay38910") {
        this.applyAyHardwareEnvelopeEnable(channel, value !== 0);
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_AY_MIXER_TONE_MASK && this.chipModel === "ay38910") {
        this.applyAyMixerToneMask(value);
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_AY_MIXER_NOISE_MASK && this.chipModel === "ay38910") {
        this.applyAyMixerNoiseMask(value);
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
    updateChannelAmplitude(current, target, usesAyHardwareEnvelope) {
      if (this.chipModel === "ay38910" && usesAyHardwareEnvelope) {
        return target;
      }
      return this.updateEnvelope(current, target);
    }
    syncNoiseFromTone2() {
      if (this.noiseChannel.frequencyMode.kind !== "tone2") {
        return;
      }
      const tone2 = this.toneChannels[_MkvdrvSongRuntime.PSG_TONE_CHANNELS - 1];
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
      const channelIndex = this.toneChannels.indexOf(channel);
      if (this.chipModel === "ay38910" && channelIndex >= 0 && !this.isAyToneEnabled(channelIndex)) {
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
    renderSn76489ToneChannel(channel) {
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
    renderNoiseChannel() {
      if (this.noiseChannel.frequency <= 0 && this.noiseChannel.amplitude < 1e-4 && this.noiseChannel.targetAmplitude <= 0) {
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
    renderSn76489NoiseChannel() {
      this.noiseChannel.clockAccumulator += this.chipCore.noiseClockStep(
        this.sampleRateValue
      );
      while (this.noiseChannel.clockAccumulator >= 1) {
        this.noiseChannel.clockAccumulator -= 1;
        if (this.noiseChannel.counter <= 1) {
          this.noiseChannel.counter = Math.max(1, this.noiseChannel.noisePeriod);
          this.noiseChannel.shiftClockOutput = this.noiseChannel.shiftClockOutput === 0 ? 1 : 0;
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
    renderMixedFrame() {
      let left = 0;
      let right = 0;
      this.advanceAyHardwareEnvelopeFrame();
      this.toneChannels.forEach((channel) => {
        channel.amplitude = this.updateChannelAmplitude(
          channel.amplitude,
          channel.targetAmplitude,
          channel.ayHardwareEnvelopeEnabled
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
        const noiseSample = this.renderNoiseChannel();
        if (this.chipModel === "ay38910") {
          const enabledToneChannels = this.toneChannels.map((channel, index) => ({ channel, index })).filter(({ index }) => this.isAyNoiseEnabled(index));
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
