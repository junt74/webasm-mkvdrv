const o = "data:video/mp2t;base64,aW1wb3J0IHsgTWt2ZHJ2U29uZ1J1bnRpbWUgfSBmcm9tICIuL3NvbmctcnVudGltZSI7CmltcG9ydCB0eXBlIHsKICBSZW5kZXJFbmdpbmUsCiAgU2VxdWVuY2VFbnZlbG9wZSwKICBTZXF1ZW5jZVBheWxvYWQKfSBmcm9tICIuL3NvbmctZm9ybWF0IjsKCnR5cGUgQ29uZmlndXJlTWVzc2FnZSA9IHsKICB0eXBlOiAiY29uZmlndXJlIjsKICByZW5kZXJFbmdpbmU6IFJlbmRlckVuZ2luZTsKICB3YXZldGFibGU6IEZsb2F0MzJBcnJheTsKICBmcmVxdWVuY3k6IG51bWJlcjsKICBub3RlRnJlcXVlbmNpZXM6IEZsb2F0MzJBcnJheTsKfTsKCnR5cGUgU3RhcnRUb25lTWVzc2FnZSA9IHsKICB0eXBlOiAic3RhcnRUb25lIjsKfTsKCnR5cGUgU3RhcnRTZXF1ZW5jZU1lc3NhZ2UgPSB7CiAgdHlwZTogInN0YXJ0U2VxdWVuY2UiOwp9ICYgU2VxdWVuY2VQYXlsb2FkOwoKdHlwZSBTdG9wTWVzc2FnZSA9IHsKICB0eXBlOiAic3RvcCI7Cn07Cgp0eXBlIFNldEZyZXF1ZW5jeU1lc3NhZ2UgPSB7CiAgdHlwZTogInNldEZyZXF1ZW5jeSI7CiAgZnJlcXVlbmN5OiBudW1iZXI7Cn07Cgp0eXBlIFNldFRlbXBvTWVzc2FnZSA9IHsKICB0eXBlOiAic2V0VGVtcG8iOwogIGJwbTogbnVtYmVyOwp9OwoKdHlwZSBTZXRNYXN0ZXJWb2x1bWVNZXNzYWdlID0gewogIHR5cGU6ICJzZXRNYXN0ZXJWb2x1bWUiOwogIHZvbHVtZTogbnVtYmVyOwp9OwoKdHlwZSBQcm9jZXNzb3JNZXNzYWdlID0KICB8IENvbmZpZ3VyZU1lc3NhZ2UKICB8IFN0YXJ0VG9uZU1lc3NhZ2UKICB8IFN0YXJ0U2VxdWVuY2VNZXNzYWdlCiAgfCBTdG9wTWVzc2FnZQogIHwgU2V0RnJlcXVlbmN5TWVzc2FnZQogIHwgU2V0VGVtcG9NZXNzYWdlCiAgfCBTZXRNYXN0ZXJWb2x1bWVNZXNzYWdlOwoKY2xhc3MgTWt2ZHJ2UHJvY2Vzc29yIGV4dGVuZHMgQXVkaW9Xb3JrbGV0UHJvY2Vzc29yIHsKICBwcml2YXRlIHJ1bnRpbWUgPSBuZXcgTWt2ZHJ2U29uZ1J1bnRpbWUoc2FtcGxlUmF0ZSk7CgogIGNvbnN0cnVjdG9yKCkgewogICAgc3VwZXIoKTsKCiAgICB0aGlzLnBvcnQub25tZXNzYWdlID0gKGV2ZW50OiBNZXNzYWdlRXZlbnQ8UHJvY2Vzc29yTWVzc2FnZT4pID0+IHsKICAgICAgY29uc3QgbWVzc2FnZSA9IGV2ZW50LmRhdGE7CgogICAgICBpZiAobWVzc2FnZS50eXBlID09PSAiY29uZmlndXJlIikgewogICAgICAgIHRoaXMucG9ydC5wb3N0TWVzc2FnZSgKICAgICAgICAgIHRoaXMucnVudGltZS5jb25maWd1cmUoewogICAgICAgICAgICByZW5kZXJFbmdpbmU6IG1lc3NhZ2UucmVuZGVyRW5naW5lLAogICAgICAgICAgICB3YXZldGFibGU6IG1lc3NhZ2Uud2F2ZXRhYmxlLAogICAgICAgICAgICBub3RlRnJlcXVlbmNpZXM6IG1lc3NhZ2Uubm90ZUZyZXF1ZW5jaWVzLAogICAgICAgICAgICBmcmVxdWVuY3k6IG1lc3NhZ2UuZnJlcXVlbmN5CiAgICAgICAgICB9KQogICAgICAgICk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAobWVzc2FnZS50eXBlID09PSAic3RhcnRUb25lIikgewogICAgICAgIHRoaXMucnVudGltZS5zdGFydFRvbmUoKTsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlmIChtZXNzYWdlLnR5cGUgPT09ICJzdGFydFNlcXVlbmNlIikgewogICAgICAgIHRoaXMucG9ydC5wb3N0TWVzc2FnZSgKICAgICAgICAgIHRoaXMucnVudGltZS5sb2FkU2VxdWVuY2UoewogICAgICAgICAgICBicG06IG1lc3NhZ2UuYnBtLAogICAgICAgICAgICB0aWNrc1BlckJlYXQ6IG1lc3NhZ2UudGlja3NQZXJCZWF0LAogICAgICAgICAgICBzZXF1ZW5jZUV2ZW50czogbWVzc2FnZS5zZXF1ZW5jZUV2ZW50cywKICAgICAgICAgICAgZXZlbnRTdHJpZGU6IG1lc3NhZ2UuZXZlbnRTdHJpZGUsCiAgICAgICAgICAgIGVudmVsb3BlczogbWVzc2FnZS5lbnZlbG9wZXMgYXMgU2VxdWVuY2VFbnZlbG9wZVtdCiAgICAgICAgICB9KQogICAgICAgICk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAobWVzc2FnZS50eXBlID09PSAic3RvcCIpIHsKICAgICAgICB0aGlzLnJ1bnRpbWUuc3RvcCgpOwogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gInNldEZyZXF1ZW5jeSIpIHsKICAgICAgICBjb25zdCBsb2cgPSB0aGlzLnJ1bnRpbWUuc2V0RnJlcXVlbmN5KG1lc3NhZ2UuZnJlcXVlbmN5KTsKICAgICAgICBpZiAobG9nKSB7CiAgICAgICAgICB0aGlzLnBvcnQucG9zdE1lc3NhZ2UobG9nKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAobWVzc2FnZS50eXBlID09PSAic2V0VGVtcG8iKSB7CiAgICAgICAgY29uc3QgbG9nID0gdGhpcy5ydW50aW1lLnNldFRlbXBvKG1lc3NhZ2UuYnBtKTsKICAgICAgICBpZiAobG9nKSB7CiAgICAgICAgICB0aGlzLnBvcnQucG9zdE1lc3NhZ2UobG9nKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAobWVzc2FnZS50eXBlID09PSAic2V0TWFzdGVyVm9sdW1lIikgewogICAgICAgIHRoaXMucG9ydC5wb3N0TWVzc2FnZSh0aGlzLnJ1bnRpbWUuc2V0TWFzdGVyVm9sdW1lKG1lc3NhZ2Uudm9sdW1lKSk7CiAgICAgIH0KICAgIH07CiAgfQoKICBwcm9jZXNzKGlucHV0czogRmxvYXQzMkFycmF5W11bXSwgb3V0cHV0czogRmxvYXQzMkFycmF5W11bXSk6IGJvb2xlYW4gewogICAgdm9pZCBpbnB1dHM7CiAgICByZXR1cm4gdGhpcy5ydW50aW1lLnByb2Nlc3Mob3V0cHV0cyk7CiAgfQp9CgpyZWdpc3RlclByb2Nlc3NvcigibWt2ZHJ2LXByb2Nlc3NvciIsIE1rdmRydlByb2Nlc3Nvcik7Cg==";
const c = {
  noteOn: 1,
  noteOff: 2,
  tempo: 3,
  volume: 4,
  noiseOn: 5,
  noiseOff: 6,
  envelopeSelect: 7
}, l = (I) => {
  const e = new Uint32Array(I.events.length * 5);
  return I.events.forEach((g, n) => {
    const C = n * 5;
    e[C] = c[g.kind], e[C + 1] = g.value >>> 0, e[C + 2] = g.deltaTicks >>> 0, e[C + 3] = g.channel >>> 0, e[C + 4] = g.param >>> 0;
  }), {
    bpm: I.events.find((g) => g.kind === "tempo")?.value ?? 124,
    ticksPerBeat: I.ticksPerBeat,
    sequenceEvents: e,
    eventStride: 5,
    envelopes: I.envelopes
  };
};
class A {
  audioContext;
  workletNode;
  currentSong;
  renderEngine = "an74689";
  masterVolume = 1;
  wavetable;
  noteFrequencies;
  initialFrequency;
  constructor(e) {
    this.initialFrequency = e?.initialFrequency ?? 440, this.wavetable = i(e?.wavetableSize ?? 2048), this.noteFrequencies = s();
  }
  async initialize() {
    this.audioContext || (this.audioContext = new AudioContext(), await this.audioContext.audioWorklet.addModule(o)), this.workletNode || (this.workletNode = new AudioWorkletNode(
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
    const t = await fetch(e);
    if (!t.ok)
      throw new Error(`Failed to load song JSON: ${t.status} ${t.statusText}`);
    const g = await t.json();
    await this.loadSong(g);
  }
  async play() {
    if (!this.currentSong)
      throw new Error("No song has been loaded.");
    await this.initialize(), await this.audioContext?.resume(), this.workletNode?.port.postMessage({
      type: "startSequence",
      ...l(this.currentSong)
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
const i = (I) => {
  const e = Math.max(32, I | 0), t = new Float32Array(e);
  for (let g = 0; g < e; g += 1)
    t[g] = Math.sin(g / e * Math.PI * 2);
  return t;
}, s = () => {
  const I = new Float32Array(128);
  for (let e = 0; e < I.length; e += 1)
    I[e] = 440 * 2 ** ((e - 69) / 12);
  return I;
};
export {
  A as MkvdrvGameAudioEngine
};
