import { MkvdrvSongRuntime } from "./song-runtime";
import type {
  RenderEngine,
  SequenceEnvelope,
  SequencePayload
} from "./song-format";

type ConfigureMessage = {
  type: "configure";
  renderEngine: RenderEngine;
  wavetable: Float32Array;
  frequency: number;
  noteFrequencies: Float32Array;
};

type StartToneMessage = {
  type: "startTone";
};

type StartSequenceMessage = {
  type: "startSequence";
} & SequencePayload;

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

type SetMasterVolumeMessage = {
  type: "setMasterVolume";
  volume: number;
};

type ProcessorMessage =
  | ConfigureMessage
  | StartToneMessage
  | StartSequenceMessage
  | StopMessage
  | SetFrequencyMessage
  | SetTempoMessage
  | SetMasterVolumeMessage;

class MkvdrvProcessor extends AudioWorkletProcessor {
  private runtime = new MkvdrvSongRuntime(sampleRate);

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const message = event.data;

      if (message.type === "configure") {
        this.port.postMessage(
          this.runtime.configure({
            renderEngine: message.renderEngine,
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
            sequenceEvents: message.sequenceEvents,
            eventStride: message.eventStride,
            envelopes: message.envelopes as SequenceEnvelope[]
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

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    void inputs;
    return this.runtime.process(outputs);
  }
}

registerProcessor("mkvdrv-processor", MkvdrvProcessor);
