import type {
  AyChannelVolumeState,
  PsgChipCore,
  PsgNoiseFrequencyMode
} from "./psg-types";

const DB_PER_STEP = 1.5;
const MASTER_CLOCK_HZ = 1_789_773;
const TONE_DIVIDER = 16;
const NOISE_DIVIDER = 16;
const MIN_PERIOD = 1;
const MAX_TONE_PERIOD = 0x0fff;
const MAX_NOISE_PERIOD = 0x1f;

export type Ay38910RegisterState = {
  tonePeriods: [number, number, number];
  channelVolumes: [
    AyChannelVolumeState,
    AyChannelVolumeState,
    AyChannelVolumeState
  ];
  noisePeriod: number;
  mixerToneMask: number;
  mixerNoiseMask: number;
  envelopePeriod: number;
  envelopeShape: number;
};

function clampNibble(value: number): number {
  return Math.max(0, Math.min(15, value));
}

function clampPeriod(value: number, max: number): number {
  return Math.max(MIN_PERIOD, Math.min(max, Math.round(value)));
}

function clampMixerMask(mask: number): number {
  return Math.max(0, Math.min(0b111, Math.round(mask))) & 0b111;
}

function clampEnvelopeShape(shape: number): number {
  return Math.max(0, Math.min(15, Math.round(shape))) & 0x0f;
}

function clampChannelVolume(level: number): number {
  return clampNibble(level);
}

export function createAy38910RegisterState(): Ay38910RegisterState {
  return {
    tonePeriods: [0, 0, 0],
    channelVolumes: [
      { level: 0, usesHardwareEnvelope: false },
      { level: 0, usesHardwareEnvelope: false },
      { level: 0, usesHardwareEnvelope: false }
    ],
    noisePeriod: 0,
    mixerToneMask: 0b111,
    mixerNoiseMask: 0b111,
    envelopePeriod: 512,
    envelopeShape: 9
  };
}

export function writeAy38910TonePeriod(
  state: Ay38910RegisterState,
  channel: 0 | 1 | 2,
  period: number
): Ay38910RegisterState {
  const next = {
    ...state,
    tonePeriods: [...state.tonePeriods] as [number, number, number]
  };
  next.tonePeriods[channel] = period <= 0 ? 0 : clampPeriod(period, MAX_TONE_PERIOD);
  return next;
}

export function writeAy38910ChannelVolume(
  state: Ay38910RegisterState,
  channel: 0 | 1 | 2,
  level: number,
  usesHardwareEnvelope: boolean
): Ay38910RegisterState {
  const next = {
    ...state,
    channelVolumes: state.channelVolumes.map((volumeState) => ({ ...volumeState })) as [
      AyChannelVolumeState,
      AyChannelVolumeState,
      AyChannelVolumeState
    ]
  };
  next.channelVolumes[channel] = {
    level: clampChannelVolume(level),
    usesHardwareEnvelope
  };
  return next;
}

export function writeAy38910NoisePeriod(
  state: Ay38910RegisterState,
  period: number
): Ay38910RegisterState {
  return {
    ...state,
    noisePeriod: period <= 0 ? 0 : clampPeriod(period, MAX_NOISE_PERIOD)
  };
}

export function writeAy38910MixerToneMask(
  state: Ay38910RegisterState,
  mask: number
): Ay38910RegisterState {
  return {
    ...state,
    mixerToneMask: clampMixerMask(mask)
  };
}

export function writeAy38910MixerNoiseMask(
  state: Ay38910RegisterState,
  mask: number
): Ay38910RegisterState {
  return {
    ...state,
    mixerNoiseMask: clampMixerMask(mask)
  };
}

export function writeAy38910EnvelopePeriod(
  state: Ay38910RegisterState,
  period: number
): Ay38910RegisterState {
  return {
    ...state,
    envelopePeriod: Math.max(1, Math.round(period))
  };
}

export function writeAy38910EnvelopeShape(
  state: Ay38910RegisterState,
  shape: number
): Ay38910RegisterState {
  return {
    ...state,
    envelopeShape: clampEnvelopeShape(shape)
  };
}

export function resolveAy38910ToneEnabled(
  state: Ay38910RegisterState,
  channel: 0 | 1 | 2
): boolean {
  return (state.mixerToneMask & (1 << channel)) !== 0;
}

export function resolveAy38910NoiseEnabled(
  state: Ay38910RegisterState,
  channel: 0 | 1 | 2
): boolean {
  return (state.mixerNoiseMask & (1 << channel)) !== 0;
}

export function resolveAy38910ChannelGain(
  state: Ay38910RegisterState,
  channel: 0 | 1 | 2,
  decodeAmplitude: (volume: number) => number,
  hardwareEnvelopeGain: number
): number {
  const volumeState = state.channelVolumes[channel];
  if (!volumeState) {
    return 0;
  }

  if (volumeState.usesHardwareEnvelope) {
    return Math.max(0, Math.min(1, hardwareEnvelopeGain));
  }

  return decodeAmplitude(volumeState.level);
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
  toneClockStep(sampleRate: number): number {
    return MASTER_CLOCK_HZ / TONE_DIVIDER / sampleRate;
  },
  noiseClockStep(sampleRate: number): number {
    return MASTER_CLOCK_HZ / NOISE_DIVIDER / sampleRate;
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
