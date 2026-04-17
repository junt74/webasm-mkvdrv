type ConfigureMessage = {
  type: "configure";
  wavetable: Float32Array;
  frequency: number;
  sampleRate: number;
};

type StartMessage = {
  type: "start";
};

type StopMessage = {
  type: "stop";
};

type SetFrequencyMessage = {
  type: "setFrequency";
  frequency: number;
};

type ProcessorMessage =
  | ConfigureMessage
  | StartMessage
  | StopMessage
  | SetFrequencyMessage;

class MkvdrvProcessor extends AudioWorkletProcessor {
  private wavetable = new Float32Array([0]);
  private phase = 0;
  private frequency = 440;
  private active = false;

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const message = event.data;

      if (message.type === "configure") {
        this.wavetable = new Float32Array(message.wavetable);
        this.frequency = message.frequency;
        this.phase = 0;
        this.port.postMessage(
          `AudioWorklet ready.\nFrequency: ${this.frequency.toFixed(0)} Hz`
        );
        return;
      }

      if (message.type === "start") {
        this.active = true;
        return;
      }

      if (message.type === "stop") {
        this.active = false;
        return;
      }

      if (message.type === "setFrequency") {
        this.frequency = message.frequency;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    void inputs;

    const output = outputs[0];

    if (!output) {
      return true;
    }

    const left = output[0];
    const right = output[1] ?? output[0];

    if (!this.active || this.wavetable.length === 0) {
      left.fill(0);
      right.fill(0);
      return true;
    }

    const tableLength = this.wavetable.length;
    const phaseStep = (this.frequency * tableLength) / sampleRate;

    for (let index = 0; index < left.length; index += 1) {
      const tableIndex = Math.floor(this.phase) % tableLength;
      const nextIndex = (tableIndex + 1) % tableLength;
      const fraction = this.phase - tableIndex;
      const sample =
        this.wavetable[tableIndex] * (1 - fraction) +
        this.wavetable[nextIndex] * fraction;

      left[index] = sample * 0.18;
      right[index] = sample * 0.18;

      this.phase += phaseStep;

      if (this.phase >= tableLength) {
        this.phase -= tableLength;
      }
    }

    return true;
  }
}

registerProcessor("mkvdrv-processor", MkvdrvProcessor);
