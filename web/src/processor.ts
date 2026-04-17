type ConfigureMessage = {
  type: "configure";
  wavetable: Float32Array;
  frequency: number;
  noteFrequencies: Float32Array;
};

type DemoStep = {
  note: number | null;
  length: number;
};

type StartToneMessage = {
  type: "startTone";
};

type StartSequenceMessage = {
  type: "startSequence";
  bpm: number;
  stepsPerBeat: number;
  gateRatio: number;
  sequence: DemoStep[];
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
  private wavetable = new Float32Array([0]);
  private noteFrequencies = new Float32Array(128);
  private phase = 0;
  private frequency = 440;
  private mode: PlaybackMode = "idle";
  private amplitude = 0;
  private targetAmplitude = 0;
  private attackRate = 0.0035;
  private releaseRate = 0.0018;
  private bpm = 124;
  private stepsPerBeat = 4;
  private gateRatio = 0.82;
  private sequence: DemoStep[] = [];
  private sequenceIndex = 0;
  private stepSamplesRemaining = 0;
  private gateSamplesRemaining = 0;
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
        this.stepsPerBeat = message.stepsPerBeat;
        this.gateRatio = message.gateRatio;
        this.sequence = message.sequence;
        this.sequenceIndex = 0;
        this.stepSamplesRemaining = 0;
        this.gateSamplesRemaining = 0;
        this.advanceSequenceStep();
        this.port.postMessage(
          `Sequence ready.\nTempo: ${this.bpm.toFixed(0)} BPM, steps: ${this.sequence.length}`
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
          this.advanceSequenceStep();
          this.port.postMessage(`Sequence tempo: ${this.bpm.toFixed(0)} BPM`);
        }
      }
    };
  }

  private advanceSequenceStep() {
    if (this.sequence.length === 0) {
      this.mode = "idle";
      this.targetAmplitude = 0;
      this.sequenceFrequency = 0;
      return;
    }

    const step = this.sequence[this.sequenceIndex];
    const stepSamples = Math.max(
      1,
      Math.round((60 / this.bpm / this.stepsPerBeat) * sampleRate * step.length)
    );

    this.stepSamplesRemaining = stepSamples;
    this.gateSamplesRemaining = Math.max(
      0,
      Math.round(stepSamples * this.gateRatio)
    );

    if (step.note == null) {
      this.sequenceFrequency = 0;
      this.targetAmplitude = 0;
    } else {
      this.sequenceFrequency = this.noteFrequencies[step.note] ?? 0;
      this.targetAmplitude = 1;
    }

    this.sequenceIndex = (this.sequenceIndex + 1) % this.sequence.length;
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
        if (this.stepSamplesRemaining <= 0) {
          this.advanceSequenceStep();
        }

        if (this.gateSamplesRemaining <= 0) {
          this.targetAmplitude = 0;
        }
      }

      const activeFrequency = this.currentFrequency();

      if ((this.mode === "idle" && this.amplitude < 1.0e-4) || activeFrequency <= 0) {
        this.targetAmplitude = this.mode === "idle" ? 0 : this.targetAmplitude;
        this.updateEnvelope();
        left[index] = 0;
        right[index] = 0;

        if (this.mode === "sequence") {
          this.stepSamplesRemaining -= 1;
          this.gateSamplesRemaining -= 1;
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
        this.stepSamplesRemaining -= 1;
        this.gateSamplesRemaining -= 1;
      }
    }

    return true;
  }
}

registerProcessor("mkvdrv-processor", MkvdrvProcessor);
