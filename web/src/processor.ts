type ConfigureMessage = {
  type: "configure";
  wavetable: Float32Array;
  frequency: number;
  noteFrequencies: Float32Array;
};

type StartToneMessage = {
  type: "startTone";
};

type StartSequenceMessage = {
  type: "startSequence";
  bpm: number;
  ticksPerBeat: number;
  sequenceEvents: Uint32Array;
  eventStride: number;
};

type StopMessage = {
  type: "stop";
};

type SetFrequencyMessage = {
  type: "setFrequency";
  frequency: number;
};

type SetTempoMessage = {
  type: "setTempo";
  bpm: number;
};

type ProcessorMessage =
  | ConfigureMessage
  | StartToneMessage
  | StartSequenceMessage
  | StopMessage
  | SetFrequencyMessage
  | SetTempoMessage;

type PlaybackMode = "idle" | "tone" | "sequence";

class MkvdrvProcessor extends AudioWorkletProcessor {
  private static readonly EVENT_NOTE_ON = 1;
  private static readonly EVENT_NOTE_OFF = 2;

  private wavetable = new Float32Array([0]);
  private noteFrequencies = new Float32Array(128);
  private sequenceEvents = new Uint32Array(0);
  private eventStride = 3;
  private phase = 0;
  private frequency = 440;
  private mode: PlaybackMode = "idle";
  private amplitude = 0;
  private targetAmplitude = 0;
  private attackRate = 0.0035;
  private releaseRate = 0.0018;
  private bpm = 124;
  private ticksPerBeat = 96;
  private sequenceIndex = 0;
  private eventSamplesRemaining = 0;
  private sequenceFrequency = 0;

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const message = event.data;

      if (message.type === "configure") {
        this.wavetable = new Float32Array(message.wavetable);
        this.noteFrequencies = new Float32Array(message.noteFrequencies);
        this.frequency = message.frequency;
        this.phase = 0;
        this.port.postMessage(
          `AudioWorklet ready.\nFrequency: ${this.frequency.toFixed(0)} Hz`
        );
        return;
      }

      if (message.type === "startTone") {
        this.mode = "tone";
        this.targetAmplitude = 1;
        return;
      }

      if (message.type === "startSequence") {
        this.mode = "sequence";
        this.bpm = message.bpm;
        this.ticksPerBeat = message.ticksPerBeat;
        this.sequenceEvents = new Uint32Array(message.sequenceEvents);
        this.eventStride = message.eventStride;
        this.sequenceIndex = 0;
        this.eventSamplesRemaining = 0;
        this.advanceSequenceEvent();
        this.port.postMessage(
          `Sequence ready.\nTempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}`
        );
        return;
      }

      if (message.type === "stop") {
        this.mode = "idle";
        this.targetAmplitude = 0;
        return;
      }

      if (message.type === "setFrequency") {
        this.frequency = message.frequency;

        if (this.mode === "tone") {
          this.port.postMessage(`Tone frequency: ${this.frequency.toFixed(0)} Hz`);
        }

        return;
      }

      if (message.type === "setTempo") {
        this.bpm = message.bpm;

        if (this.mode === "sequence") {
          this.port.postMessage(`Sequence tempo: ${this.bpm.toFixed(0)} BPM`);
        }
      }
    };
  }

  private advanceSequenceEvent() {
    if (this.sequenceEvents.length === 0) {
      this.mode = "idle";
      this.targetAmplitude = 0;
      this.sequenceFrequency = 0;
      return;
    }

    const base = this.sequenceIndex * this.eventStride;
    const eventKind = this.sequenceEvents[base];
    const note = this.sequenceEvents[base + 1];
    const lengthTicks = this.sequenceEvents[base + 2];
    const eventSamples = Math.max(
      1,
      Math.round((60 / this.bpm / this.ticksPerBeat) * sampleRate * lengthTicks)
    );

    this.eventSamplesRemaining = eventSamples;

    if (eventKind === MkvdrvProcessor.EVENT_NOTE_ON) {
      this.sequenceFrequency = this.noteFrequencies[note] ?? 0;
      this.targetAmplitude = 1;
    } else if (eventKind === MkvdrvProcessor.EVENT_NOTE_OFF) {
      this.sequenceFrequency = 0;
      this.targetAmplitude = 0;
    } else {
      this.targetAmplitude = 0;
    }

    this.sequenceIndex =
      (this.sequenceIndex + 1) % (this.sequenceEvents.length / this.eventStride);
  }

  private currentFrequency(): number {
    if (this.mode === "sequence") {
      return this.sequenceFrequency;
    }

    return this.frequency;
  }

  private updateEnvelope() {
    const rate =
      this.targetAmplitude > this.amplitude ? this.attackRate : this.releaseRate;

    this.amplitude += (this.targetAmplitude - this.amplitude) * rate;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    void inputs;

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

    const tableLength = this.wavetable.length;

    for (let index = 0; index < left.length; index += 1) {
      if (this.mode === "sequence") {
        if (this.eventSamplesRemaining <= 0) {
          this.advanceSequenceEvent();
        }
      }

      const activeFrequency = this.currentFrequency();

      if ((this.mode === "idle" && this.amplitude < 1.0e-4) || activeFrequency <= 0) {
        this.targetAmplitude = this.mode === "idle" ? 0 : this.targetAmplitude;
        this.updateEnvelope();
        left[index] = 0;
        right[index] = 0;

        if (this.mode === "sequence") {
          this.eventSamplesRemaining -= 1;
        }

        continue;
      }

      const phaseStep = (activeFrequency * tableLength) / sampleRate;
      const tableIndex = Math.floor(this.phase) % tableLength;
      const nextIndex = (tableIndex + 1) % tableLength;
      const fraction = this.phase - tableIndex;
      const sample =
        this.wavetable[tableIndex] * (1 - fraction) +
        this.wavetable[nextIndex] * fraction;

      this.updateEnvelope();

      left[index] = sample * this.amplitude * 0.22;
      right[index] = sample * this.amplitude * 0.22;

      this.phase += phaseStep;

      if (this.phase >= tableLength) {
        this.phase -= tableLength;
      }

      if (this.mode === "sequence") {
        this.eventSamplesRemaining -= 1;
      }
    }

    return true;
  }
}

registerProcessor("mkvdrv-processor", MkvdrvProcessor);
