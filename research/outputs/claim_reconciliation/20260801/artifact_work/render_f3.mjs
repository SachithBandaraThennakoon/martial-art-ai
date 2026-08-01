import fs from "node:fs/promises";
import sharp from "sharp";
const src="research/figures/verified/20260801/F3_combat_cognition_architecture_evidence_flow.svg";
const dst="research/figures/verified/20260801/F3_combat_cognition_architecture_evidence_flow.png";
await sharp(await fs.readFile(src)).png({compressionLevel:9}).toFile(dst);
console.log("Rendered F3 PNG");
