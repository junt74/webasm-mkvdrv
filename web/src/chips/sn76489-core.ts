import type { PsgChipCore, PsgNoiseFrequencyMode } from "./psg-types";

const DB_PER_STEP = 2;
const MASTER_CLOCK_HZ = 3_579_545;
const TONE_DIVIDER = 32;
const NOISE_DIVIDER = 32;
const RENDER_CLOCK_DIVIDER = 16;
const MIN_PERIOD = 1;
const MAX_TONE_PERIOD = 0x3ff;
const MAX_NOISE_PERIOD = 0x3ff;
const DISCRETE_NOISE_PERIODS = [0x10, 0x20, 0x40] as const;
const SN76489_LFSR_RESET = 0x4000;
const SN76489_LFSR_MASK = 0x7fff;
const SN76489_ENVELOPE_GAIN_TABLE = Array.from({ length: 16 }, (_, level) =>
  level >= 15 ? 0 : 10 ** (-(level * DB_PER_STEP) / 20)
);
const SN76489_VOLUME_TABLE = Array.from({ length: 16 }, (_, level) =>
  level <= 0 ? 0 : SN76489_ENVELOPE_GAIN_TABLE[15 - level] ?? 0
);

export type Sn76489NoiseSource =
  | "clock_div_512"
  | "clock_div_1024"
  | "clock_div_2048"
  | "tone2";

export type Sn76489RegisterState = {
  tonePeriods: [number, number, number];
  volumeRegisters: [number, number, number, number];
  noiseMode: number;
  noiseSource: Sn76489NoiseSource;
  latchedRegister: number;
};

export type Sn76489WriteStep =
  | {
      kind: "latchTone";
      register: 0 | 2 | 4;
      value: number;
    }
  | {
      kind: "dataTone";
      register: 0 | 2 | 4;
      value: number;
    }
  | {
      kind: "latchVolume";
      register: 1 | 3 | 5 | 7;
      value: number;
    }
  | {
      kind: "latchNoise";
      register: 6;
      value: number;
    };

export type Sn76489NoiseControlWriteResult = {
  state: Sn76489RegisterState;
  controlChanged: boolean;
  sourceChanged: boolean;
  modeChanged: boolean;
  resetReason: "none" | "mode" | "source" | "mode+source";
  resetLfsr: boolean;
  reloadCounter: boolean;
};

export type Sn76489NoiseShiftResult = {
  lfsr: number;
  output: 1 | -1;
};

function clampNibble(value: number): number {
  return Math.max(0, Math.min(15, value));
}

function clampPeriod(value: number, max: number): number {
  return Math.max(MIN_PERIOD, Math.min(max, Math.round(value)));
}

function cloneRegisterState(state: Sn76489RegisterState): Sn76489RegisterState {
  return {
    ...state,
    tonePeriods: [...state.tonePeriods] as [number, number, number],
    volumeRegisters: [...state.volumeRegisters] as [number, number, number, number]
  };
}

export function decomposeSn76489TonePeriodWrite(
  channel: 0 | 1 | 2,
  period: number
): [Sn76489WriteStep, Sn76489WriteStep] {
  const normalized = clampPeriod(period, MAX_TONE_PERIOD);
  const register = (channel * 2) as 0 | 2 | 4;
  return [
    {
      kind: "latchTone",
      register,
      value: normalized & 0x0f
    },
    {
      kind: "dataTone",
      register,
      value: (normalized >> 4) & 0x3f
    }
  ];
}

export function decomposeSn76489VolumeWrite(
  channel: 0 | 1 | 2 | 3,
  volume: number
): [Sn76489WriteStep] {
  return [
    {
      kind: "latchVolume",
      register: (channel * 2 + 1) as 1 | 3 | 5 | 7,
      value: clampNibble(volume)
    }
  ];
}

export function decomposeSn76489NoiseControlWriteStep(
  resolvedSource: Sn76489NoiseSource,
  noiseMode: number
): Sn76489WriteStep {
  const sourceBits =
    resolvedSource === "clock_div_512"
      ? 0
      : resolvedSource === "clock_div_1024"
        ? 1
        : resolvedSource === "clock_div_2048"
          ? 2
          : 3;
  return {
    kind: "latchNoise",
    register: 6,
    value: ((noiseMode & 0x01) << 2) | sourceBits
  };
}

export function applySn76489WriteStep(
  state: Sn76489RegisterState,
  step: Sn76489WriteStep
): Sn76489RegisterState {
  const next = cloneRegisterState(state);

  if (step.kind === "latchTone") {
    const channel = (step.register / 2) as 0 | 1 | 2;
    const previous = next.tonePeriods[channel] & 0x3f0;
    next.tonePeriods[channel] = previous | (step.value & 0x0f);
    next.latchedRegister = step.register;
    return next;
  }

  if (step.kind === "dataTone") {
    const channel = (step.register / 2) as 0 | 1 | 2;
    const previous = next.tonePeriods[channel] & 0x00f;
    next.tonePeriods[channel] = previous | ((step.value & 0x3f) << 4);
    next.latchedRegister = step.register;
    return next;
  }

  if (step.kind === "latchVolume") {
    const channel = ((step.register - 1) / 2) as 0 | 1 | 2 | 3;
    next.volumeRegisters[channel] = step.value & 0x0f;
    next.latchedRegister = step.register;
    return next;
  }

  const sourceBits = step.value & 0x03;
  next.noiseMode = (step.value >> 2) & 0x01;
  next.noiseSource =
    sourceBits === 0
      ? "clock_div_512"
      : sourceBits === 1
        ? "clock_div_1024"
        : sourceBits === 2
          ? "clock_div_2048"
          : "tone2";
  next.latchedRegister = 6;
  return next;
}

export function resetSn76489Lfsr(): number {
  return SN76489_LFSR_RESET;
}

export function shiftSn76489Lfsr(
  lfsr: number,
  noiseMode: number
): Sn76489NoiseShiftResult {
  const normalized = (lfsr & SN76489_LFSR_MASK) || SN76489_LFSR_RESET;
  const feedbackBit =
    noiseMode === 0 ? periodicFeedbackBit(normalized) : whiteFeedbackBit(normalized);
  const nextLfsr = ((normalized >> 1) | (feedbackBit << 14)) & SN76489_LFSR_MASK;
  return {
    lfsr: nextLfsr || SN76489_LFSR_RESET,
    output: (nextLfsr & 1) !== 0 ? 1 : -1
  };
}

function discreteNoiseModeFromFrequency(
  targetFrequency: number,
  tone2Frequency: number
): PsgNoiseFrequencyMode {
  if (targetFrequency <= 0) {
    return {
      kind: "continuous",
      frequency: 0,
      period: 0
    };
  }

  const fixedCandidates = DISCRETE_NOISE_PERIODS.map((period) => {
    const frequency = MASTER_CLOCK_HZ / (NOISE_DIVIDER * period);
    return {
      kind: "continuous" as const,
      frequency,
      period
    };
  });
  const candidates: Array<
    PsgNoiseFrequencyMode & {
      distance: number;
    }
  > = fixedCandidates.map((candidate) => ({
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

function frequencyForNoiseSource(
  source: Sn76489NoiseSource,
  tone2Frequency: number
): number {
  if (source === "tone2") {
    return Math.max(0, tone2Frequency);
  }

  const period =
    source === "clock_div_512"
      ? DISCRETE_NOISE_PERIODS[0]
      : source === "clock_div_1024"
        ? DISCRETE_NOISE_PERIODS[1]
        : DISCRETE_NOISE_PERIODS[2];
  return MASTER_CLOCK_HZ / (NOISE_DIVIDER * period);
}

function sourceForDiscretePeriod(period: number): Sn76489NoiseSource {
  if (period <= DISCRETE_NOISE_PERIODS[0]) {
    return "clock_div_512";
  }
  if (period <= DISCRETE_NOISE_PERIODS[1]) {
    return "clock_div_1024";
  }
  return "clock_div_2048";
}

export function createSn76489RegisterState(): Sn76489RegisterState {
  return {
    tonePeriods: [0, 0, 0],
    volumeRegisters: [0, 0, 0, 0],
    noiseMode: 1,
    noiseSource: "clock_div_1024",
    latchedRegister: 0
  };
}

export function writeSn76489TonePeriod(
  state: Sn76489RegisterState,
  channel: 0 | 1 | 2,
  period: number
): Sn76489RegisterState {
  const [latchStep, dataStep] = decomposeSn76489TonePeriodWrite(channel, period);
  return applySn76489WriteStep(applySn76489WriteStep(state, latchStep), dataStep);
}

export function writeSn76489Volume(
  state: Sn76489RegisterState,
  channel: 0 | 1 | 2 | 3,
  volume: number
): Sn76489RegisterState {
  const [step] = decomposeSn76489VolumeWrite(channel, volume);
  return applySn76489WriteStep(state, step);
}

export function writeSn76489NoiseControl(
  state: Sn76489RegisterState,
  targetFrequency: number,
  tone2Frequency: number,
  noiseMode: number
): Sn76489NoiseControlWriteResult {
  const resolved = discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
  const next = {
    ...cloneRegisterState(state),
    latchedRegister: 6
  };
  const previousMode = state.noiseMode;
  const previousSource = state.noiseSource;
  next.noiseMode = noiseMode;

  if (resolved.kind === "tone2") {
    const step = decomposeSn76489NoiseControlWriteStep("tone2", noiseMode);
    const applied = applySn76489WriteStep(next, step);
    const modeChanged = previousMode !== next.noiseMode;
    const sourceChanged = previousSource !== applied.noiseSource;
    const controlChanged = modeChanged || sourceChanged;
    return {
      state: applied,
      controlChanged,
      sourceChanged,
      modeChanged,
      resetReason: controlChanged
        ? modeChanged && sourceChanged
          ? "mode+source"
          : modeChanged
            ? "mode"
            : "source"
        : "none",
      resetLfsr: controlChanged,
      reloadCounter: sourceChanged
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
    resetReason: controlChanged
      ? modeChanged && sourceChanged
        ? "mode+source"
        : modeChanged
          ? "mode"
          : "source"
      : "none",
    resetLfsr: controlChanged,
    reloadCounter: sourceChanged
  };
}

export function resolveSn76489NoiseState(
  state: Sn76489RegisterState,
  tone2Frequency: number
): { frequency: number; frequencyMode: PsgNoiseFrequencyMode } {
  if (state.noiseSource === "tone2") {
    return {
      frequency: Math.max(0, tone2Frequency),
      frequencyMode: { kind: "tone2" }
    };
  }

  const frequency = frequencyForNoiseSource(state.noiseSource, tone2Frequency);
  const period =
    state.noiseSource === "clock_div_512"
      ? DISCRETE_NOISE_PERIODS[0]
      : state.noiseSource === "clock_div_1024"
        ? DISCRETE_NOISE_PERIODS[1]
        : DISCRETE_NOISE_PERIODS[2];

  return {
    frequency,
    frequencyMode: {
      kind: "continuous",
      frequency,
      period
    }
  };
}

export const sn76489Core: PsgChipCore = {
  chipModel: "sn76489",
  decodeEnvelopeGain(level: number): number {
    return SN76489_ENVELOPE_GAIN_TABLE[clampNibble(level)] ?? 0;
  },
  decodeAmplitude(volume: number): number {
    return SN76489_VOLUME_TABLE[clampNibble(volume)] ?? 0;
  },
  toneOutputLevel(): number {
    return 0.12;
  },
  noiseOutputLevel(): number {
    return 0.1;
  },
  toneClockStep(sampleRate: number): number {
    // The SN76489 tone/noise counters are clocked after the chip's fixed
    // prescaler, while the audible output toggles on counter rollover.
    // Keeping period conversion at /32 and the runtime clock step at /16
    // aligns the rendered pitch with the requested note frequency.
    return MASTER_CLOCK_HZ / RENDER_CLOCK_DIVIDER / sampleRate;
  },
  noiseClockStep(sampleRate: number): number {
    return MASTER_CLOCK_HZ / RENDER_CLOCK_DIVIDER / sampleRate;
  },
  tonePeriodFromFrequency(frequency: number): number {
    if (frequency <= 0) {
      return 0;
    }
    return clampPeriod(MASTER_CLOCK_HZ / (TONE_DIVIDER * frequency), MAX_TONE_PERIOD);
  },
  toneFrequencyFromPeriod(period: number): number {
    if (period <= 0) {
      return 0;
    }
    return MASTER_CLOCK_HZ / (TONE_DIVIDER * clampPeriod(period, MAX_TONE_PERIOD));
  },
  noisePeriodFromFrequency(frequency: number): number {
    if (frequency <= 0) {
      return 0;
    }
    return clampPeriod(MASTER_CLOCK_HZ / (NOISE_DIVIDER * frequency), MAX_NOISE_PERIOD);
  },
  noiseFrequencyFromPeriod(period: number): number {
    if (period <= 0) {
      return 0;
    }
    return MASTER_CLOCK_HZ / (NOISE_DIVIDER * clampPeriod(period, MAX_NOISE_PERIOD));
  },
  resolveNoiseFrequencyMode(
    targetFrequency: number,
    tone2Frequency: number
  ): PsgNoiseFrequencyMode {
    return discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
  },
  renderToneSample(phase: number): number {
    return phase < 0.5 ? 1 : -1;
  },
  periodicNoiseFeedbackBit(lfsr: number): number {
    return periodicFeedbackBit(lfsr);
  },
  whiteNoiseFeedbackBit(lfsr: number): number {
    return whiteFeedbackBit(lfsr);
  }
};

function periodicFeedbackBit(lfsr: number): number {
  return lfsr & 1;
}

function whiteFeedbackBit(lfsr: number): number {
  return (lfsr ^ (lfsr >> 1)) & 1;
}
