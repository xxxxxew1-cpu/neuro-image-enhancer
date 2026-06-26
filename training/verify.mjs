// Load the saved model exactly the way the browser does (tfjs-layers
// loadLayersModel) and run one prediction — proves the serialized artifacts
// are valid before shipping.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { loadLayersModel } from '@tensorflow/tfjs-layers';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'enhance');

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();

  const modelJSON = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
  const bin = readFileSync(join(dir, 'weights.bin'));
  const handler = {
    load: async () => ({
      modelTopology: modelJSON.modelTopology,
      weightSpecs: modelJSON.weightsManifest[0].weights,
      weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
      format: modelJSON.format,
    }),
  };

  const model = await loadLayersModel(handler);
  const y = model.predict(tf.zeros([1, 64, 64, 3]));
  const vals = Array.from(await y.data()).map((v) => v.toFixed(4));
  console.log(`✓ model loads. output shape=${JSON.stringify(y.shape)} values=[${vals.join(', ')}]`);
  if (y.shape[1] !== 3) {
    console.error('❌ expected 3 outputs');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌ verify failed:', e.message);
  process.exit(1);
});
