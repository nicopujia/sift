// Builds the extension into dist/. Run `bun run build` or `bun run watch`.
import { cp, mkdir, rm, exists } from "node:fs/promises";
import { watch } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
// SIFT_OUT lets two people build the same tree into different folders.
const out = root + (process.env.SIFT_OUT ?? "dist") + "/";

async function build() {
  const t0 = performance.now();
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const common = { minify: false, sourcemap: "none" as const, target: "browser" as const };
  const results = await Promise.all([
    Bun.build({ ...common, entrypoints: [root + "src/content/index.ts"], outdir: out, naming: "content.js", format: "iife" }),
    Bun.build({ ...common, entrypoints: [root + "src/background/index.ts"], outdir: out, naming: "background.js", format: "esm" }),
    Bun.build({ ...common, entrypoints: [root + "src/options/index.tsx"], outdir: out, naming: "options.js", format: "iife" }),
    Bun.build({ ...common, entrypoints: [root + "src/main/index.ts"], outdir: out, naming: "main.js", format: "iife" }),
  ]);
  for (const r of results) if (!r.success) { for (const l of r.logs) console.error(l); throw new Error("build failed"); }
  await cp(root + "static", out, { recursive: true });
  // A local API key for development installs. Never committed (see .gitignore).
  if (await exists(root + "local-key.json")) await cp(root + "local-key.json", out + "local-key.json");
  console.log(`built in ${Math.round(performance.now() - t0)} ms`);
}

await build();
if (process.argv.includes("--watch")) {
  let timer: Timer | undefined;
  for (const dir of ["src", "static"]) watch(root + dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 100);
  });
  console.log("watching…");
}
