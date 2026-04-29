import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svg = readFileSync(join(root, "src/assets/icon.svg"));

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const out = join(root, `src/assets/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`generated ${out}`);
}
