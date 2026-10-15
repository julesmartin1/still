// Rebuilds the natural voice runtime in dist/vendor/kokoro/ (see
// dist/natural-voice.js). Still has no build step; this is only run by hand
// when the vendored libraries are updated. Run it from still/:
//
//   mkdir /tmp/kokoro && cd /tmp/kokoro && npm init -y &&
//     npm install --ignore-scripts kokoro-js@1.2.1 esbuild@0.28.2
//   cd - && node scripts/build-kokoro.mjs /tmp/kokoro/node_modules
//
// It bundles kokoro-js, Transformers.js, ONNX Runtime Web (its WebAssembly
// build only: no WebGPU, so one 11 MB .wasm file instead of 21 MB) and
// phonemizer into one ES module, copies the runtime's .wasm file and its
// JavaScript glue beside it, the voices
// Still offers and the licenses. The bundle loads nothing from a CDN: the
// WebAssembly path points beside the bundle, and voices are read from
// ./voices/ instead of being downloaded.
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const modules = resolve(process.argv[2] || "node_modules");
const require = createRequire(join(modules, "noop.js"));
const { build } = require("esbuild");
const out = resolve("dist/vendor/kokoro");
const VOICES = ["af_heart", "af_bella", "bf_emma", "am_michael"];

const entry = `
import { env as hf } from "@huggingface/transformers";
export { KokoroTTS } from "kokoro-js";
export { phonemize } from "phonemizer";
export const versions = { transformers: hf.version };
// Never fall back to a CDN for the WebAssembly runtime: its .wasm file and
// JavaScript glue (.mjs) are beside this file.
hf.backends.onnx.wasm.wasmPaths = new URL("./", import.meta.url).href;
hf.backends.onnx.wasm.proxy = false;
hf.allowLocalModels = false;
export const env = hf;
`;
// kokoro-js reads voices with fs/promises in Node and downloads them in
// browsers; these stand-ins read the vendored copies instead.
const shims = {
  path: `export default { resolve: (...parts) => parts.filter(Boolean).join("/") };`,
  "fs/promises": `
const base = new URL("./voices/", import.meta.url);
export default {
  async readFile(path) {
    const name = String(path).split("/").pop();
    if (!/^[a-z]{2}_[a-z]+\\.bin$/.test(name)) throw Error("Unknown voice");
    const response = await fetch(new URL(name, base));
    if (!response.ok) throw Error("Voice not found: " + name);
    return new Uint8Array(await response.arrayBuffer());
  },
};`,
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "voices"), { recursive: true });
await build({
  stdin: { contents: entry, resolveDir: modules, loader: "js" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  outfile: join(out, "kokoro.js"),
  logLevel: "warning",
  plugins: [
    {
      name: "still-kokoro",
      setup(b) {
        b.onResolve({ filter: /^(path|fs\/promises)$/ }, (args) => ({
          path: args.path,
          namespace: "shim",
        }));
        b.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
          contents: shims[args.path],
          loader: "js",
        }));
        // The WebAssembly-only build of ONNX Runtime, with its JavaScript
        // glue bundled in (ort.wasm.bundle.min.mjs).
        b.onResolve({ filter: /^onnxruntime-web$/ }, (args) =>
          b.resolve("onnxruntime-web/wasm", {
            kind: "import-statement",
            resolveDir: args.resolveDir,
          }),
        );
      },
    },
  ],
});
const ort = join(
  require.resolve("onnxruntime-web/wasm", {
    paths: [join(modules, "@huggingface/transformers")],
  }),
  "..",
);
for (const file of [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
])
  await copyFile(join(ort, file), join(out, file));
for (const voice of VOICES)
  await copyFile(
    join(modules, "kokoro-js/voices", voice + ".bin"),
    join(out, "voices", voice + ".bin"),
  );
const version = async (name) =>
  JSON.parse(await readFile(join(modules, name, "package.json"), "utf8"))
    .version;
const ORT_LICENSE = `MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const licenses = [
  ["kokoro-js", "kokoro-js/LICENSE", "Apache-2.0"],
  [
    "@huggingface/transformers",
    "@huggingface/transformers/LICENSE",
    "Apache-2.0",
  ],
  ["@huggingface/jinja", "@huggingface/jinja/LICENSE", "MIT"],
  ["onnxruntime-web", null, "MIT"],
  ["phonemizer", "phonemizer/LICENSE", "Apache-2.0"],
];
let text = `Third-party software in this folder (natural voice, read aloud)

kokoro.js bundles the packages below (built by still/scripts/build-kokoro.mjs).
ort-wasm-simd-threaded.wasm is from onnxruntime-web. voices/*.bin are Kokoro-82M
voice files from kokoro-js. The Kokoro-82M weights (Apache-2.0, hexgrad,
https://huggingface.co/hexgrad/Kokoro-82M) are downloaded at first use from
https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX.

phonemizer contains eSpeak NG compiled to WebAssembly. eSpeak NG is licensed
under the GNU General Public License, version 3 or later; its source is at
https://github.com/espeak-ng/espeak-ng and phonemizer's build of it at
https://github.com/xenova/phonemizer.js. The GPL text is in GPL-3.0.txt.
`;
for (const [name, file, license] of licenses) {
  // onnxruntime-web ships without a LICENSE file; its license is MIT.
  const body = file
    ? await readFile(resolve(modules, file), "utf8")
    : ORT_LICENSE;
  const v = await version(name).catch(() => "?");
  text += `\n\n==== ${name} ${v} (${license}) ====\n\n${body.trim()}\n`;
}
await writeFile(join(out, "LICENSES.txt"), text);
await copyFile("/usr/share/common-licenses/GPL-3", join(out, "GPL-3.0.txt"));
console.log("Built", out);
