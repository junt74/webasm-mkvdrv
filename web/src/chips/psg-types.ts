import type { SoundChipModel } from "../song-format";

export type PsgNoiseFrequencyMode =
  | {
      kind: "continuous";
      frequency: number;
      period: number;
    }
  | {
      kind: "tone2";
    };

export type AyChannelVolumeState = {
  level: number;
  usesHardwareEnvelope: boolean;
};

export type PsgChipCore = {
  readonly chipModel: SoundChipModel;
  decodeEnvelopeGain(level: number): number;
  decodeAmplitude(volume: number): number;
  toneOutputLevel(): number;
  noiseOutputLevel(): number;
  toneClockStep(sampleRate: number): number;
  noiseClockStep(sampleRate: number): number;
  tonePeriodFromFrequency(frequency: number): number;
  toneFrequencyFromPeriod(period: number): number;
  noisePeriodFromFrequency(frequency: number): number;
  noiseFrequencyFromPeriod(period: number): number;
  resolveNoiseFrequencyMode(
    targetFrequency: number,
    tone2Frequency: number
  ): PsgNoiseFrequencyMode;
  renderToneSample(phase: number): number;
  periodicNoiseFeedbackBit(lfsr: number): number;
  whiteNoiseFeedbackBit(lfsr: number): number;
};
