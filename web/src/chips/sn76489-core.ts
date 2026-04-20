import type { PsgChipCore, PsgNoiseFrequencyMode } from "./psg-types";

const DB_PER_STEP = 2;
const MASTER_CLOCK_HZ = 3_579_545;
const TONE_DIVIDER = 32;
const NOISE_DIVIDER = 32;
const MIN_PERIOD = 1;
const MAX_TONE_PERIOD = 0x3ff;
const MAX_NOISE_PERIOD = 0x3ff;
const DISCRETE_NOISE_PERIODS = [0x10, 0x20, 0x40] as const;

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

function clampNibble(value: number): number {
  return Math.max(0, Math.min(15, value));
}

function clampPeriod(value: number, max: number): number {
  return Math.max(MIN_PERIOD, Math.min(max, Math.round(value)));
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
  const next = {
    ...state,
    tonePeriods: [...state.tonePeriods] as [number, number, number],
    volumeRegisters: [...state.volumeRegisters] as [number, number, number, number],
    latchedRegister: channel * 2
  };
  next.tonePeriods[channel] = clampPeriod(period, MAX_TONE_PERIOD);
  return next;
}

export function writeSn76489Volume(
  state: Sn76489RegisterState,
  channel: 0 | 1 | 2 | 3,
  volume: number
): Sn76489RegisterState {
  const next = {
    ...state,
    tonePeriods: [...state.tonePeriods] as [number, number, number],
    volumeRegisters: [...state.volumeRegisters] as [number, number, number, number],
    latchedRegister: channel * 2 + 1
  };
  next.volumeRegisters[channel] = clampNibble(volume);
  return next;
}

export function writeSn76489NoiseControl(
  state: Sn76489RegisterState,
  targetFrequency: number,
  tone2Frequency: number,
  noiseMode: number
): Sn76489RegisterState {
  const resolved = discreteNoiseModeFromFrequency(targetFrequency, tone2Frequency);
  const next = {
    ...state,
    tonePeriods: [...state.tonePeriods] as [number, number, number],
    volumeRegisters: [...state.volumeRegisters] as [number, number, number, number],
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
    const clamped = clampNibble(level);
    if (clamped >= 15) {
      return 0;
    }
    return 10 ** (-(clamped * DB_PER_STEP) / 20);
  },
  decodeAmplitude(volume: number): number {
    const clamped = clampNibble(volume);
    if (clamped === 0) {
      return 0;
    }
    const attenuationSteps = 15 - clamped;
    return 10 ** (-(attenuationSteps * DB_PER_STEP) / 20);
  },
  toneOutputLevel(): number {
    return 0.12;
  },
  noiseOutputLevel(): number {
    return 0.1;
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
    return lfsr & 1;
  },
  whiteNoiseFeedbackBit(lfsr: number): number {
    return (lfsr ^ (lfsr >> 1)) & 1;
  }
};
