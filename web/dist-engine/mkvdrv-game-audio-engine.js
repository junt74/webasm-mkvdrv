const a = {
  noteOn: 1,
  noteOff: 2,
  tempo: 3,
  volume: 4,
  noiseOn: 5,
  noiseOff: 6,
  envelopeSelect: 7,
  pan: 8,
  pitchEnvelopeSelect: 9
}, r = (t) => {
  const e = new Uint32Array(t.events.length * 5);
  return t.events.forEach((o, i) => {
    const n = i * 5;
    e[n] = a[o.kind], e[n + 1] = o.value >>> 0, e[n + 2] = o.deltaTicks >>> 0, e[n + 3] = o.channel >>> 0, e[n + 4] = o.param >>> 0;
  }), {
    bpm: t.events.find((o) => o.kind === "tempo")?.value ?? 124,
    ticksPerBeat: t.ticksPerBeat,
    loopCount: t.loopCount ?? 0,
    tailTicks: t.tailTicks ?? 0,
    chipModel: t.engine ?? "sn76489",
    sequenceEvents: e,
    eventStride: 5,
    envelopes: t.envelopes,
    pitchEnvelopes: t.pitchEnvelopes ?? []
  };
}, l = new URL(
  /* @vite-ignore */
  "./mkvdrv-processor.worklet.js",
  import.meta.url
).href;
class h {
  audioContext;
  workletNode;
  currentSong;
  renderEngine = "psg";
  chipModel = "sn76489";
  masterVolume = 1;
  wavetable;
  noteFrequencies;
  initialFrequency;
  constructor(e) {
    this.initialFrequency = e?.initialFrequency ?? 440, this.wavetable = u(e?.wavetableSize ?? 2048), this.noteFrequencies = c();
  }
  async initialize() {
    this.audioContext || (this.audioContext = new AudioContext(), await this.audioContext.audioWorklet.addModule(l)), this.workletNode || (this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "mkvdrv-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "discrete"
      }
    ), this.workletNode.connect(this.audioContext.destination), this.workletNode.port.postMessage(this.buildConfigureMessage()), this.workletNode.port.postMessage({
      type: "setMasterVolume",
      volume: this.masterVolume
    }));
  }
  async loadSong(e) {
    await this.initialize(), this.currentSong = e, this.chipModel = e.engine ?? "sn76489", this.workletNode?.port.postMessage(this.buildConfigureMessage());
  }
  async loadSongFromUrl(e) {
    const s = await fetch(e);
    if (!s.ok)
      throw new Error(`Failed to load song JSON: ${s.status} ${s.statusText}`);
    const o = await s.json();
    await this.loadSong(o);
  }
  async play() {
    if (!this.currentSong)
      throw new Error("No song has been loaded.");
    await this.initialize(), await this.audioContext?.resume(), this.workletNode?.port.postMessage({
      type: "startSequence",
      ...r(this.currentSong)
    });
  }
  async stop() {
    this.workletNode?.port.postMessage({ type: "stop" }), await this.audioContext?.suspend();
  }
  async pause() {
    await this.audioContext?.suspend();
  }
  async resume() {
    await this.audioContext?.resume();
  }
  setMasterVolume(e) {
    this.masterVolume = Math.max(0, Math.min(1, e)), this.workletNode?.port.postMessage({
      type: "setMasterVolume",
      volume: this.masterVolume
    });
  }
  setRenderEngine(e) {
    this.renderEngine = e, this.workletNode?.port.postMessage(this.buildConfigureMessage());
  }
  setChipModel(e) {
    this.chipModel = e, this.workletNode?.port.postMessage(this.buildConfigureMessage());
  }
  buildConfigureMessage() {
    return {
      type: "configure",
      renderEngine: this.renderEngine,
      chipModel: this.chipModel,
      wavetable: this.wavetable,
      frequency: this.initialFrequency,
      noteFrequencies: this.noteFrequencies
    };
  }
}
const u = (t) => {
  const e = Math.max(32, t | 0), s = new Float32Array(e);
  for (let o = 0; o < e; o += 1)
    s[o] = Math.sin(o / e * Math.PI * 2);
  return s;
}, c = () => {
  const t = new Float32Array(128);
  for (let e = 0; e < t.length; e += 1)
    t[e] = 440 * 2 ** ((e - 69) / 12);
  return t;
};
export {
  h as MkvdrvGameAudioEngine
};
