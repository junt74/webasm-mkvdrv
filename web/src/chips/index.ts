import type { SoundChipModel } from "../song-format";
import { ay38910Core } from "./ay38910-core";
import { sn76489Core } from "./sn76489-core";
import type { PsgChipCore } from "./psg-types";

const CHIP_CORES: Record<SoundChipModel, PsgChipCore> = {
  sn76489: sn76489Core,
  ay38910: ay38910Core
};

export function getPsgChipCore(chipModel: SoundChipModel): PsgChipCore {
  return CHIP_CORES[chipModel] ?? sn76489Core;
}
