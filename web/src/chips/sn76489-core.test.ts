import test from "node:test";
import assert from "node:assert/strict";

import {
  applySn76489WriteStep,
  createSn76489RegisterState,
  decomposeSn76489NoiseControlWriteStep,
  decomposeSn76489TonePeriodWrite,
  decomposeSn76489VolumeWrite,
  resetSn76489Lfsr,
  shiftSn76489Lfsr,
  writeSn76489NoiseControl
} from "./sn76489-core.ts";

test("SN76489 tone period write is expressed as latch then data", () => {
  const [latchStep, dataStep] = decomposeSn76489TonePeriodWrite(1, 0x12a);

  assert.deepEqual(latchStep, {
    kind: "latchTone",
    register: 2,
    value: 0x0a
  });
  assert.deepEqual(dataStep, {
    kind: "dataTone",
    register: 2,
    value: 0x12
  });

  const state = createSn76489RegisterState();
  const latched = applySn76489WriteStep(state, latchStep);
  assert.equal(latched.latchedRegister, 2);
  assert.equal(latched.tonePeriods[1], 0x00a);

  const completed = applySn76489WriteStep(latched, dataStep);
  assert.equal(completed.latchedRegister, 2);
  assert.equal(completed.tonePeriods[1], 0x12a);
});

test("SN76489 volume write is a latch write to the volume register", () => {
  const [step] = decomposeSn76489VolumeWrite(3, 9);
  const state = applySn76489WriteStep(createSn76489RegisterState(), step);

  assert.deepEqual(step, {
    kind: "latchVolume",
    register: 7,
    value: 9
  });
  assert.equal(state.latchedRegister, 7);
  assert.equal(state.volumeRegisters[3], 9);
});

test("SN76489 noise control write step encodes source bits and mode bit", () => {
  const step = decomposeSn76489NoiseControlWriteStep("tone2", 1);
  const state = applySn76489WriteStep(createSn76489RegisterState(), step);

  assert.deepEqual(step, {
    kind: "latchNoise",
    register: 6,
    value: 0b111
  });
  assert.equal(state.latchedRegister, 6);
  assert.equal(state.noiseMode, 1);
  assert.equal(state.noiseSource, "tone2");
});

test("SN76489 noise control reports source/mode changes separately", () => {
  const state = createSn76489RegisterState();
  const result = writeSn76489NoiseControl(state, 1800, 1700, 0);

  assert.equal(result.state.latchedRegister, 6);
  assert.equal(result.modeChanged, true);
  assert.equal(result.sourceChanged, true);
  assert.equal(result.resetReason, "mode+source");
  assert.equal(result.resetLfsr, true);
});

test("SN76489 LFSR helper resets and shifts deterministically", () => {
  const reset = resetSn76489Lfsr();
  const periodic = shiftSn76489Lfsr(reset, 0);
  const white = shiftSn76489Lfsr(reset, 1);

  assert.equal(reset, 0x4000);
  assert.equal(periodic.lfsr, 0x2000);
  assert.equal(periodic.output, -1);
  assert.equal(white.lfsr, 0x2000);
  assert.equal(white.output, -1);
});
