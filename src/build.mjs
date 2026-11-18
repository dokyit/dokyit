// Builds every image in ../assets from blocks.html.
//   node src/build.mjs
// Needs Google Chrome (headless, throwaway profile) and cwebp (brew install webp).
// Output is deterministic: the banner uses a fixed seed and the screenshots are files in src/shots.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./cdp.mjs";

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, "..", "assets");
const KEEP = process.env.KEEP_PNG; // set to a folder to keep the PNG captures for review
const TMP = KEEP || join(SRC, ".png");
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// name, block, widths/gutters. Desktop column is 846 css px; phone blocks are 340.
// Pinny and Shelf sit side by side on desktop: 423 px each with a 4 px inner gutter.
const JOBS = [
  { out: "header", block: "header", w: 846, phone: true },
  { out: "trek", block: "trek", w: 846, phone: true },
  { out: "pinny", block: "pinny", w: 419, gr: 4, phone: true },
  { out: "shelf", block: "shelf", w: 419, gl: 4, phone: true, phoneTop: 17 },
  { out: "stack", block: "stack", w: 846, phone: true },
  // three buttons span the 846 column with 8 px gutters: 277 + 276 + 277 visible
  // On a phone they stack, so their phone versions centre one 277 px button in the same image width.
  { out: "link-site", block: "link-site", w: 277, gr: 4, phone: { w: 277, gl: 2, gr: 2 } },
  { out: "link-linkedin", block: "link-linkedin", w: 276, gl: 4, gr: 4, phone: { w: 277, gl: 3.5, gr: 3.5 } },
  { out: "link-github", block: "link-github", w: 277, gl: 4, phone: { w: 277, gl: 2, gr: 2 } },
];

// Screenshots carry photographic detail: lossy WebP at high quality. Flat blocks: lossless.
const LOSSY = new Set(["trek", "pinny", "shelf"]);

const chrome = await launch();
const sizes = {};
try {
  for (const job of JOBS) {
    const variants = [
      { suffix: "dark", theme: "dark", w: job.w, gl: job.gl, gr: job.gr },
      { suffix: "light", theme: "light", w: job.w, gl: job.gl, gr: job.gr },
    ];
    if (job.phone) variants.push({ suffix: "phone", theme: "dark", w: 340, gl: 0, gr: 0, gt: job.phoneTop || 0, ...(typeof job.phone === "object" ? job.phone : {}) });
    for (const v of variants) {
      const params = new URLSearchParams({ block: job.block, theme: v.theme, w: String(v.w ?? 846), gl: String(v.gl || 0), gr: String(v.gr || 0), gt: String(v.gt || 0), phone: v.suffix === "phone" ? "1" : "0" });
      await chrome.open(`${pathToFileURL(join(SRC, "blocks.html"))}?${params}`, { width: 1000 });
      for (let i = 0; i < 100 && !(await chrome.evaluate("window.__ready === true")); i++) await new Promise((r) => setTimeout(r, 50));
      const rect = await chrome.evaluate(`(() => { const r = document.getElementById("root").getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
      const png = await chrome.shot(rect);
      const name = `${job.out}-${v.suffix}`;
      const tmp = join(TMP, `${name}.png`);
      writeFileSync(tmp, png);
      const dst = join(OUT, `${name}.webp`);
      const args = LOSSY.has(job.block)
        ? ["-quiet", "-q", "90", "-m", "6", "-sharp_yuv", "-alpha_q", "100", tmp, "-o", dst]
        : ["-quiet", "-lossless", "-z", "9", tmp, "-o", dst];
      execFileSync("cwebp", args);
      sizes[name] = { cssWidth: rect.width, cssHeight: rect.height };
      console.log(`${name.padEnd(22)} ${rect.width}x${rect.height} css`);
    }
  }
} finally {
  await chrome.close();
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
}
writeFileSync(join(SRC, "sizes.json"), JSON.stringify(sizes, null, 2) + "\n");
