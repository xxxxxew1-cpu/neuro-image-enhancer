// Diagnostic: is the model input-adaptive, and what does it do to well-exposed
// images? Loads the shipped model and prints predicted B/C/S factors for a
// range of controlled inputs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { loadLayersModel } from '@tensorflow/tfjs-layers';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'enhance');
const SCALE = [0.7, 0.5, 0.7];

function gray(v) {
  return tf.fill([1, 64, 64, 3], v);
}
// vertical gradient with given mean and contrast span
function gradient(mean, span) {
  return tf.tidy(() => {
    const r = tf.reshape(tf.linspace(mean - span / 2, mean + span / 2, 64), [1, 64, 1, 1]);
    return tf.clipByValue(tf.tile(r, [1, 1, 64, 3]), 0, 1);
  });
}

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();
  const modelJSON = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
  const bin = readFileSync(join(dir, 'weights.bin'));
  const model = await loadLayersModel({
    load: async () => ({
      modelTopology: modelJSON.modelTopology,
      weightSpecs: modelJSON.weightsManifest[0].weights,
      weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
      format: modelJSON.format,
    }),
  });

  const cases = [
    ['gray 0.15 (very dark)', gray(0.15)],
    ['gray 0.30 (dark)', gray(0.3)],
    ['gray 0.50 (mid)', gray(0.5)],
    ['gray 0.70 (bright)', gray(0.7)],
    ['gray 0.85 (very bright)', gray(0.85)],
    ['grad mean .45 span .7 (good contrast)', gradient(0.45, 0.7)],
    ['grad mean .45 span .2 (low contrast)', gradient(0.45, 0.2)],
  ];

  console.log('input                                  →  B      C      S');
  for (const [label, x] of cases) {
    const out = model.predict(x);
    const o = await out.data();
    const f = o.slice(0, 3).map((v, i) => Math.exp(SCALE[i] * v));
    console.log(
      `${label.padEnd(38)} →  ${f[0].toFixed(2)}   ${f[1].toFixed(2)}   ${f[2].toFixed(2)}`,
    );
    x.dispose();
    out.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
