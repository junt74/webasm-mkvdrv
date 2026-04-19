"use strict";
(() => {
  // src/song-runtime.ts
  var MkvdrvSongRuntime = class _MkvdrvSongRuntime {
    constructor(sampleRateValue) {
      this.sampleRateValue = sampleRateValue;
      this.samplesPerTick = sampleRateValue / 192;
      this.tickSamplesRemaining = this.samplesPerTick;
      this.noiseChannel = this.createNoiseChannel();
      this.resetChannels();
    }
    static EVENT_NOTE_ON = 1;
    static EVENT_NOTE_OFF = 2;
    static EVENT_TEMPO = 3;
    static EVENT_VOLUME = 4;
    static EVENT_NOISE_ON = 5;
    static EVENT_NOISE_OFF = 6;
    static EVENT_ENVELOPE_SELECT = 7;
    static PSG_TONE_CHANNELS = 3;
    static PSG_NOISE_CHANNEL = 3;
    static PSG_NOISE_MODE_PERIODIC = 0;
    static PSG_NOISE_MODE_WHITE = 1;
    wavetable = new Float32Array([0]);
    noteFrequencies = new Float32Array(128);
    renderEngine = "an74689";
    sequenceEvents = new Uint32Array(0);
    eventStride = 5;
    previewFrequency = 440;
    mode = "idle";
    attackRate = 35e-4;
    releaseRate = 18e-4;
    bpm = 124;
    ticksPerBeat = 96;
    loopCount = 0;
    loopsRemaining = 0;
    tailTicks = 0;
    sequenceIndex = 0;
    pendingTerminalAction = "none";
    eventSamplesRemaining = 0;
    samplesPerTick;
    tickSamplesRemaining;
    masterVolume = 1;
    envelopes = /* @__PURE__ */ new Map();
    toneChannels = [];
    noiseChannel;
    configure({
      renderEngine,
      wavetable,
      noteFrequencies,
      frequency
    }) {
      this.renderEngine = renderEngine;
      this.wavetable = new Float32Array(wavetable);
      this.noteFrequencies = new Float32Array(noteFrequencies);
      this.previewFrequency = frequency;
      this.resetChannels();
      this.configureTonePreviewVoices(frequency);
      return `AudioWorklet ready.
Engine: ${this.renderEngine}
Frequency: ${this.previewFrequency.toFixed(0)} Hz`;
    }
    startTone() {
      this.mode = "tone";
      this.configureTonePreviewVoices(this.previewFrequency);
    }
    loadSequence(payload) {
      this.mode = "sequence";
      this.bpm = payload.bpm;
      this.ticksPerBeat = payload.ticksPerBeat;
      this.loopCount = payload.loopCount;
      this.loopsRemaining = this.loopCount < 0 ? -1 : Math.max(0, this.loopCount);
      this.tailTicks = payload.tailTicks;
      this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
      this.tickSamplesRemaining = this.samplesPerTick;
      this.sequenceEvents = new Uint32Array(payload.sequenceEvents);
      this.eventStride = payload.eventStride;
      this.envelopes = new Map(
        payload.envelopes.map((envelope) => [envelope.id, envelope])
      );
      this.sequenceIndex = 0;
      this.eventSamplesRemaining = 0;
      this.pendingTerminalAction = "none";
      this.resetChannels();
      this.advanceSequenceEvent();
      return `Sequence ready.
Tempo: ${this.bpm.toFixed(0)} BPM, events: ${this.sequenceEvents.length / this.eventStride}, loop: ${this.loopCount}`;
    }
    stop() {
      this.mode = "idle";
      this.silenceAllChannels();
    }
    setFrequency(frequency) {
      this.previewFrequency = frequency;
      if (this.mode === "tone") {
        this.configureTonePreviewVoices(frequency);
        return `Tone frequency: ${this.previewFrequency.toFixed(0)} Hz`;
      }
      return void 0;
    }
    setTempo(bpm) {
      this.bpm = bpm;
      this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
      if (this.mode === "sequence") {
        return `Sequence tempo: ${this.bpm.toFixed(0)} BPM`;
      }
      return void 0;
    }
    setMasterVolume(volume) {
      this.masterVolume = Math.max(0, Math.min(1, volume));
      return `Master volume: ${(this.masterVolume * 100).toFixed(0)}%`;
    }
    process(outputs) {
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
      for (let index = 0; index < left.length; index += 1) {
        if (this.mode === "sequence") {
          while (this.eventSamplesRemaining <= 0) {
            if (this.pendingTerminalAction !== "none") {
              this.resolvePendingTerminalAction();
              if (this.mode !== "sequence" || this.eventSamplesRemaining > 0) {
                break;
              }
              continue;
            }
            this.advanceSequenceEvent();
            if (this.mode !== "sequence") {
              break;
            }
          }
        }
        const hasActiveTone = this.toneChannels.some(
          (channel) => channel.frequency > 0 || channel.amplitude >= 1e-4 || channel.targetAmplitude > 0
        );
        const hasActiveNoise = this.noiseChannel.frequency > 0 || this.noiseChannel.amplitude >= 1e-4 || this.noiseChannel.targetAmplitude > 0;
        if (this.mode === "idle" && !hasActiveTone && !hasActiveNoise) {
          left[index] = 0;
          right[index] = 0;
        } else {
          const sample = this.renderMixedSample() * this.masterVolume;
          left[index] = sample;
          right[index] = sample;
        }
        if (this.mode === "sequence") {
          this.eventSamplesRemaining -= 1;
          this.tickSamplesRemaining -= 1;
          while (this.tickSamplesRemaining <= 0) {
            this.advanceEnvelopeTick();
            this.tickSamplesRemaining += Math.max(1, this.samplesPerTick);
          }
        }
      }
      return true;
    }
    createToneChannel() {
      return {
        phase: 0,
        frequency: 0,
        amplitude: 0,
        targetAmplitude: 0,
        baseAmplitude: 0,
        envelopeId: 0,
        envelopeGain: 1,
        envelopeStepIndex: 0,
        envelopeSpeedCounter: 0,
        envelopeActive: false
      };
    }
    createNoiseChannel() {
      return {
        phase: 0,
        frequency: 0,
        amplitude: 0,
        targetAmplitude: 0,
        lfsr: 16384,
        output: 1,
        mode: _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE,
        baseAmplitude: 0,
        envelopeId: 0,
        envelopeGain: 1,
        envelopeStepIndex: 0,
        envelopeSpeedCounter: 0,
        envelopeActive: false
      };
    }
    resetChannels() {
      this.toneChannels = Array.from(
        { length: _MkvdrvSongRuntime.PSG_TONE_CHANNELS },
        () => this.createToneChannel()
      );
      this.noiseChannel = this.createNoiseChannel();
    }
    silenceAllChannels() {
      this.toneChannels.forEach((channel) => {
        channel.targetAmplitude = 0;
        channel.baseAmplitude = 0;
        channel.frequency = 0;
        channel.envelopeActive = false;
        channel.envelopeGain = 1;
      });
      this.noiseChannel.targetAmplitude = 0;
      this.noiseChannel.baseAmplitude = 0;
      this.noiseChannel.frequency = 0;
      this.noiseChannel.envelopeActive = false;
      this.noiseChannel.envelopeGain = 1;
    }
    setToneChannel(channelIndex, frequency, targetAmplitude, restartEnvelope = false) {
      const channel = this.toneChannels[channelIndex];
      if (!channel) {
        return;
      }
      channel.frequency = frequency;
      channel.baseAmplitude = targetAmplitude;
      if (frequency <= 0 || targetAmplitude <= 0) {
        channel.envelopeActive = false;
        channel.envelopeGain = 1;
      }
      if (restartEnvelope) {
        this.restartToneEnvelope(channel);
      }
      this.refreshToneTarget(channel);
    }
    setNoiseChannel(frequency, targetAmplitude, mode, restartEnvelope = false) {
      this.noiseChannel.frequency = frequency;
      this.noiseChannel.baseAmplitude = targetAmplitude;
      if (frequency <= 0 || targetAmplitude <= 0) {
        this.noiseChannel.envelopeActive = false;
        this.noiseChannel.envelopeGain = 1;
      }
      if (mode !== void 0) {
        this.noiseChannel.mode = mode;
      }
      if (restartEnvelope) {
        this.restartNoiseEnvelope();
      }
      this.refreshNoiseTarget();
      if (frequency > 0) {
        this.noiseChannel.phase = 0;
        this.noiseChannel.lfsr = 16384;
        this.noiseChannel.output = 1;
      }
    }
    decodeEnvelopeGain(level) {
      const clamped = Math.max(0, Math.min(15, level));
      if (clamped >= 15) {
        return 0;
      }
      return 10 ** (-(clamped * 2) / 20);
    }
    refreshToneTarget(channel) {
      channel.targetAmplitude = channel.baseAmplitude * channel.envelopeGain;
    }
    refreshNoiseTarget() {
      this.noiseChannel.targetAmplitude = this.noiseChannel.baseAmplitude * this.noiseChannel.envelopeGain;
    }
    restartToneEnvelope(channel) {
      const envelope = this.envelopes.get(channel.envelopeId);
      if (!envelope || envelope.values.length === 0) {
        channel.envelopeActive = false;
        channel.envelopeStepIndex = 0;
        channel.envelopeSpeedCounter = 0;
        channel.envelopeGain = 1;
        return;
      }
      channel.envelopeActive = true;
      channel.envelopeStepIndex = 0;
      channel.envelopeSpeedCounter = 0;
      channel.envelopeGain = this.decodeEnvelopeGain(envelope.values[0] ?? 0);
    }
    restartNoiseEnvelope() {
      const envelope = this.envelopes.get(this.noiseChannel.envelopeId);
      if (!envelope || envelope.values.length === 0) {
        this.noiseChannel.envelopeActive = false;
        this.noiseChannel.envelopeStepIndex = 0;
        this.noiseChannel.envelopeSpeedCounter = 0;
        this.noiseChannel.envelopeGain = 1;
        return;
      }
      this.noiseChannel.envelopeActive = true;
      this.noiseChannel.envelopeStepIndex = 0;
      this.noiseChannel.envelopeSpeedCounter = 0;
      this.noiseChannel.envelopeGain = this.decodeEnvelopeGain(
        envelope.values[0] ?? 0
      );
    }
    advanceChannelEnvelope(channel) {
      if (!channel.envelopeActive || channel.envelopeId === 0) {
        return;
      }
      const envelope = this.envelopes.get(channel.envelopeId);
      if (!envelope || envelope.values.length === 0) {
        channel.envelopeActive = false;
        channel.envelopeGain = 1;
        return;
      }
      channel.envelopeSpeedCounter += 1;
      if (channel.envelopeSpeedCounter < envelope.speed) {
        return;
      }
      channel.envelopeSpeedCounter = 0;
      const nextIndex = channel.envelopeStepIndex + 1;
      if (nextIndex < envelope.values.length) {
        channel.envelopeStepIndex = nextIndex;
        channel.envelopeGain = this.decodeEnvelopeGain(
          envelope.values[nextIndex] ?? 15
        );
        return;
      }
      if (envelope.loopStart !== void 0 && envelope.loopStart < envelope.values.length) {
        channel.envelopeStepIndex = envelope.loopStart;
        channel.envelopeGain = this.decodeEnvelopeGain(
          envelope.values[channel.envelopeStepIndex] ?? 15
        );
        return;
      }
      channel.envelopeActive = false;
      channel.envelopeGain = this.decodeEnvelopeGain(
        envelope.values[envelope.values.length - 1] ?? 15
      );
    }
    advanceEnvelopeTick() {
      this.toneChannels.forEach((channel) => {
        this.advanceChannelEnvelope(channel);
        this.refreshToneTarget(channel);
      });
      this.advanceChannelEnvelope(this.noiseChannel);
      this.refreshNoiseTarget();
    }
    decodePsgAmplitude(volume) {
      const clamped = Math.max(0, Math.min(15, volume));
      if (clamped === 0) {
        return 0;
      }
      const attenuationSteps = 15 - clamped;
      return 10 ** (-(attenuationSteps * 2) / 20);
    }
    decodeNoiseParam(param) {
      if (param > 255) {
        return {
          volume: param & 255,
          mode: param >>> 8 & 255
        };
      }
      return {
        volume: Math.max(0, Math.min(15, param)),
        mode: _MkvdrvSongRuntime.PSG_NOISE_MODE_WHITE
      };
    }
    configureTonePreviewVoices(frequency) {
      const previewFrequencies = [frequency, frequency * 1.5, frequency * 2];
      this.toneChannels.forEach((channel, index) => {
        channel.frequency = previewFrequencies[index] ?? frequency;
        channel.baseAmplitude = this.decodePsgAmplitude(15);
        channel.envelopeId = 0;
        channel.envelopeGain = 1;
        channel.envelopeActive = false;
        this.refreshToneTarget(channel);
      });
      this.noiseChannel.frequency = 0;
      this.noiseChannel.baseAmplitude = 0;
      this.noiseChannel.targetAmplitude = 0;
    }
    advanceSequenceEvent() {
      if (this.sequenceEvents.length === 0) {
        this.mode = "idle";
        this.silenceAllChannels();
        return;
      }
      const base = this.sequenceIndex * this.eventStride;
      const eventKind = this.sequenceEvents[base];
      const value = this.sequenceEvents[base + 1];
      const lengthTicks = this.sequenceEvents[base + 2];
      const channel = this.sequenceEvents[base + 3] ?? 0;
      const param = this.sequenceEvents[base + 4] ?? 0;
      const toneAmplitude = this.decodePsgAmplitude(param);
      const noiseSettings = this.decodeNoiseParam(param);
      const noiseAmplitude = this.decodePsgAmplitude(noiseSettings.volume);
      if (eventKind === _MkvdrvSongRuntime.EVENT_NOTE_ON) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          this.setToneChannel(
            channel,
            this.noteFrequencies[value] ?? 0,
            toneAmplitude || this.decodePsgAmplitude(15),
            true
          );
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOTE_OFF) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          this.setToneChannel(channel, 0, 0);
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.setNoiseChannel(0, 0);
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_TEMPO) {
        this.bpm = value;
        this.samplesPerTick = 60 / this.bpm / this.ticksPerBeat * this.sampleRateValue;
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_VOLUME) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.baseAmplitude = this.decodePsgAmplitude(value);
            this.refreshToneTarget(toneChannel);
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.baseAmplitude = this.decodePsgAmplitude(value);
          this.noiseChannel.mode = param;
          this.refreshNoiseTarget();
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_ENVELOPE_SELECT) {
        if (channel < _MkvdrvSongRuntime.PSG_TONE_CHANNELS) {
          const toneChannel = this.toneChannels[channel];
          if (toneChannel) {
            toneChannel.envelopeId = value;
            if (toneChannel.frequency > 0 || toneChannel.baseAmplitude > 0) {
              this.restartToneEnvelope(toneChannel);
              this.refreshToneTarget(toneChannel);
            }
          }
        } else if (channel === _MkvdrvSongRuntime.PSG_NOISE_CHANNEL) {
          this.noiseChannel.envelopeId = value;
          if (this.noiseChannel.frequency > 0 || this.noiseChannel.baseAmplitude > 0) {
            this.restartNoiseEnvelope();
            this.refreshNoiseTarget();
          }
        }
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOISE_ON) {
        this.setNoiseChannel(
          value,
          noiseAmplitude || this.decodePsgAmplitude(8),
          noiseSettings.mode,
          true
        );
      } else if (eventKind === _MkvdrvSongRuntime.EVENT_NOISE_OFF) {
        this.setNoiseChannel(0, 0);
      } else {
        this.silenceAllChannels();
      }
      const eventCount = this.sequenceEvents.length / this.eventStride;
      const nextSequenceIndex = this.sequenceIndex + 1;
      if (nextSequenceIndex >= eventCount) {
        const terminalDelaySamples = this.readTailDelaySamples();
        if (this.loopsRemaining < 0) {
          if (terminalDelaySamples > 0) {
            this.pendingTerminalAction = "wrap";
            this.eventSamplesRemaining = terminalDelaySamples;
            return;
          }
          this.sequenceIndex = 0;
          this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
          return;
        }
        if (this.loopsRemaining > 0) {
          this.loopsRemaining -= 1;
          if (terminalDelaySamples > 0) {
            this.pendingTerminalAction = "wrap";
            this.eventSamplesRemaining = terminalDelaySamples;
            return;
          }
          this.sequenceIndex = 0;
          this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
          return;
        }
        if (terminalDelaySamples > 0) {
          this.pendingTerminalAction = "stop";
          this.eventSamplesRemaining = terminalDelaySamples;
          return;
        }
        this.sequenceIndex = eventCount;
        this.eventSamplesRemaining = 0;
        this.mode = "idle";
        return;
      }
      this.sequenceIndex = nextSequenceIndex;
      this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
    }
    resolvePendingTerminalAction() {
      const action = this.pendingTerminalAction;
      this.pendingTerminalAction = "none";
      if (action === "wrap") {
        this.sequenceIndex = 0;
        this.eventSamplesRemaining = this.readUpcomingEventDelaySamples();
        return;
      }
      if (action === "stop") {
        this.sequenceIndex = this.sequenceEvents.length / this.eventStride;
        this.eventSamplesRemaining = 0;
        this.mode = "idle";
      }
    }
    readUpcomingEventDelaySamples() {
      if (this.sequenceEvents.length === 0) {
        return 0;
      }
      const nextBase = this.sequenceIndex * this.eventStride;
      const deltaTicks = this.sequenceEvents[nextBase + 2] ?? 0;
      if (deltaTicks <= 0) {
        return 0;
      }
      return Math.max(
        1,
        Math.round(
          60 / this.bpm / this.ticksPerBeat * this.sampleRateValue * deltaTicks
        )
      );
    }
    readTailDelaySamples() {
      if (this.tailTicks <= 0) {
        return 0;
      }
      return Math.max(
        1,
        Math.round(
          60 / this.bpm / this.ticksPerBeat * this.sampleRateValue * this.tailTicks
        )
      );
    }
    updateEnvelope(current, target) {
      const rate = target > current ? this.attackRate : this.releaseRate;
      return current + (target - current) * rate;
    }
    renderSineChannel(channel) {
      const tableLength = this.wavetable.length;
      const phaseStep = channel.frequency * tableLength / this.sampleRateValue;
      const tableIndex = Math.floor(channel.phase) % tableLength;
      const nextIndex = (tableIndex + 1) % tableLength;
      const fraction = channel.phase - tableIndex;
      const sample = this.wavetable[tableIndex] * (1 - fraction) + this.wavetable[nextIndex] * fraction;
      channel.phase += phaseStep;
      if (channel.phase >= tableLength) {
        channel.phase -= tableLength;
      }
      return sample;
    }
    renderPsgToneChannel(channel) {
      const phaseStep = channel.frequency / this.sampleRateValue;
      const cyclePhase = channel.phase - Math.floor(channel.phase);
      const sample = cyclePhase < 0.5 ? 1 : -1;
      channel.phase += phaseStep;
      if (channel.phase >= 1) {
        channel.phase -= Math.floor(channel.phase);
      }
      return sample;
    }
    renderNoiseChannel() {
      if (this.noiseChannel.frequency <= 0 && this.noiseChannel.amplitude < 1e-4 && this.noiseChannel.targetAmplitude <= 0) {
        return 0;
      }
      const phaseStep = Math.max(1, this.noiseChannel.frequency) / this.sampleRateValue;
      this.noiseChannel.phase += phaseStep;
      while (this.noiseChannel.phase >= 1) {
        const feedbackBit = this.noiseChannel.mode === _MkvdrvSongRuntime.PSG_NOISE_MODE_PERIODIC ? this.noiseChannel.lfsr & 1 : (this.noiseChannel.lfsr ^ this.noiseChannel.lfsr >> 1) & 1;
        const feedback = feedbackBit << 14;
        this.noiseChannel.lfsr = this.noiseChannel.lfsr >> 1 | feedback;
        this.noiseChannel.output = this.noiseChannel.lfsr & 1 ? 1 : -1;
        this.noiseChannel.phase -= 1;
      }
      this.noiseChannel.amplitude = this.updateEnvelope(
        this.noiseChannel.amplitude,
        this.noiseChannel.targetAmplitude
      );
      return this.noiseChannel.output * this.noiseChannel.amplitude * 0.1;
    }
    renderMixedSample() {
      let mix = 0;
      this.toneChannels.forEach((channel) => {
        channel.amplitude = this.updateEnvelope(
          channel.amplitude,
          channel.targetAmplitude
        );
        if (channel.frequency <= 0 || channel.amplitude < 1e-4) {
          return;
        }
        const sample = this.renderEngine === "an74689" ? this.renderPsgToneChannel(channel) : this.renderSineChannel(channel);
        const outputLevel = this.renderEngine === "an74689" ? 0.12 : 0.22;
        mix += sample * channel.amplitude * outputLevel;
      });
      if (this.renderEngine === "an74689") {
        mix += this.renderNoiseChannel();
      }
      return mix / 4;
    }
  };

  // src/processor.ts
  var MkvdrvProcessor = class extends AudioWorkletProcessor {
    runtime = new MkvdrvSongRuntime(sampleRate);
    constructor() {
      super();
      this.port.onmessage = (event) => {
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
              envelopes: message.envelopes
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
    process(inputs, outputs) {
      void inputs;
      return this.runtime.process(outputs);
    }
  };
  registerProcessor("mkvdrv-processor", MkvdrvProcessor);
})();
