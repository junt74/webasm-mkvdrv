import type { PsgChipCore, PsgNoiseFrequencyMode } from "./psg-types";

const DB_PER_STEP = 1.5;
const MASTER_CLOCK_HZ = 1_789_773;
const TONE_DIVIDER = 16;
const NOISE_DIVIDER = 16;
const MIN_PERIOD = 1;
const MAX_TONE_PERIOD = 0x0fff;
const MAX_NOISE_PERIOD = 0x1f;

function clampNibble(value: number): number {
  return Math.max(0, Math.min(15, value));
}

function clampPeriod(value: number, max: number): number {
  return Math.max(MIN_PERIOD, Math.min(max, Math.round(value)));
}

export const ay38910Core: PsgChipCore = {
  chipModel: "ay38910",
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
    return 0.1;
  },
  noiseOutputLevel(): number {
    return 0.07;
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
    _tone2Frequency: number
  ): PsgNoiseFrequencyMode {
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
  renderToneSample(phase: number): number {
    return phase < 0.5 ? 0.85 : -0.85;
  },
  periodicNoiseFeedbackBit(lfsr: number): number {
    return (lfsr >> 3) & 1;
  },
  whiteNoiseFeedbackBit(lfsr: number): number {
    return (lfsr ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
  }
};
