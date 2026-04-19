const a = {
  noteOn: 1,
  noteOff: 2,
  tempo: 3,
  volume: 4,
  noiseOn: 5,
  noiseOff: 6,
  envelopeSelect: 7
}, r = (o) => {
  const e = new Uint32Array(o.events.length * 5);
  return o.events.forEach((t, i) => {
    const n = i * 5;
    e[n] = a[t.kind], e[n + 1] = t.value >>> 0, e[n + 2] = t.deltaTicks >>> 0, e[n + 3] = t.channel >>> 0, e[n + 4] = t.param >>> 0;
  }), {
    bpm: o.events.find((t) => t.kind === "tempo")?.value ?? 124,
    ticksPerBeat: o.ticksPerBeat,
    sequenceEvents: e,
    eventStride: 5,
    envelopes: o.envelopes
  };
}, l = new URL(
  /* @vite-ignore */
  "./mkvdrv-processor.worklet.js",
  import.meta.url
).href;
class c {
  audioContext;
  workletNode;
  currentSong;
  renderEngine = "an74689";
  masterVolume = 1;
  wavetable;
  noteFrequencies;
  initialFrequency;
  constructor(e) {
    this.initialFrequency = e?.initialFrequency ?? 440, this.wavetable = u(e?.wavetableSize ?? 2048), this.noteFrequencies = d();
  }
  async initialize() {
    this.audioContext || (this.audioContext = new AudioContext(), await this.audioContext.audioWorklet.addModule(l)), this.workletNode || (this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "mkvdrv-processor"
    ), this.workletNode.connect(this.audioContext.destination), this.workletNode.port.postMessage(this.buildConfigureMessage()), this.workletNode.port.postMessage({
      type: "setMasterVolume",
      volume: this.masterVolume
    }));
  }
  async loadSong(e) {
    await this.initialize(), this.currentSong = e;
  }
  async loadSongFromUrl(e) {
    const s = await fetch(e);
    if (!s.ok)
      throw new Error(`Failed to load song JSON: ${s.status} ${s.statusText}`);
    const t = await s.json();
    await this.loadSong(t);
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
  buildConfigureMessage() {
    return {
      type: "configure",
      renderEngine: this.renderEngine,
      wavetable: this.wavetable,
      frequency: this.initialFrequency,
      noteFrequencies: this.noteFrequencies
    };
  }
}
const u = (o) => {
  const e = Math.max(32, o | 0), s = new Float32Array(e);
  for (let t = 0; t < e; t += 1)
    s[t] = Math.sin(t / e * Math.PI * 2);
  return s;
}, d = () => {
  const o = new Float32Array(128);
  for (let e = 0; e < o.length; e += 1)
    o[e] = 440 * 2 ** ((e - 69) / 12);
  return o;
};
export {
  c as MkvdrvGameAudioEngine
};
