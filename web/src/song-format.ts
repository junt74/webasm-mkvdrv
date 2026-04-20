export type RenderEngine = "sine" | "psg";
export type SoundChipModel = "sn76489" | "ay38910";

export type SequenceEnvelope = {
  id: number;
  speed: number;
  values: number[];
  loopStart?: number;
};

export type SequencePitchEnvelope = {
  id: number;
  initialOffset: number;
  speed: number;
  step: number;
  delay: number;
};

export type ExportedSongChannel = {
  id: number;
  role: "tone" | "noise";
};

export type ExportedSongEventKind =
  | "noteOn"
  | "noteOff"
  | "tempo"
  | "volume"
  | "noiseOn"
  | "noiseOff"
  | "envelopeSelect"
  | "pan"
  | "pitchEnvelopeSelect";

export type ExportedSongEvent = {
  deltaTicks: number;
  kind: ExportedSongEventKind;
  channel: number;
  value: number;
  param: number;
};

export type ExportedSong = {
  format: "mkvdrv-song";
  version: 1;
  engine: SoundChipModel;
  ticksPerBeat: number;
  loopCount: number;
  tailTicks: number;
  channels: ExportedSongChannel[];
  envelopes: SequenceEnvelope[];
  pitchEnvelopes: SequencePitchEnvelope[];
  events: ExportedSongEvent[];
};

export type SequencePayload = {
  bpm: number;
  ticksPerBeat: number;
  loopCount: number;
  tailTicks: number;
  chipModel: SoundChipModel;
  sequenceEvents: Uint32Array;
  eventStride: number;
  envelopes: SequenceEnvelope[];
  pitchEnvelopes: SequencePitchEnvelope[];
};

export const SEQUENCE_EVENT_STRIDE = 5;

const EVENT_KIND_TO_CODE: Record<ExportedSongEventKind, number> = {
  noteOn: 1,
  noteOff: 2,
  tempo: 3,
  volume: 4,
  noiseOn: 5,
  noiseOff: 6,
  envelopeSelect: 7,
  pan: 8,
  pitchEnvelopeSelect: 9
};

export const sequencePayloadFromSong = (song: ExportedSong): SequencePayload => {
  const data = new Uint32Array(song.events.length * SEQUENCE_EVENT_STRIDE);

  song.events.forEach((event, index) => {
    const base = index * SEQUENCE_EVENT_STRIDE;
    data[base] = EVENT_KIND_TO_CODE[event.kind];
    data[base + 1] = event.value >>> 0;
    data[base + 2] = event.deltaTicks >>> 0;
    data[base + 3] = event.channel >>> 0;
    data[base + 4] = event.param >>> 0;
  });

  const firstTempo = song.events.find((event) => event.kind === "tempo");

  return {
    bpm: firstTempo?.value ?? 124,
    ticksPerBeat: song.ticksPerBeat,
    loopCount: song.loopCount ?? 0,
    tailTicks: song.tailTicks ?? 0,
    chipModel: song.engine ?? "sn76489",
    sequenceEvents: data,
    eventStride: SEQUENCE_EVENT_STRIDE,
    envelopes: song.envelopes,
    pitchEnvelopes: song.pitchEnvelopes ?? []
  };
};
