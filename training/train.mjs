// Self-supervised training of the enhancement regressor.
//
// Usage:  node training/train.mjs [steps] [batch] [size]
//   defaults: steps=700 batch=16 size=64
//
// Loss is end-to-end: predict correction factors, re-apply them to the
// degraded input with the SAME ops the browser uses, and compare to the clean
// target. The model therefore learns corrections expressible by the real
// apply step. No native deps — pure-JS CPU backend; weights are written with a
// custom IO handler so @tensorflow/tfjs-node is not required.
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from './model.mjs';
import { tf, applyAdjustments, genBatch } from './dsp.mjs';

const STEPS = Number(process.argv[2] ?? 700);
const BATCH = Number(process.argv[3] ?? 16);
const SIZE = Number(process.argv[4] ?? 64);
const LR = 1e-3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'models', 'enhance');

function mse(a, b) {
  return tf.tidy(() => tf.mean(tf.square(tf.sub(a, b))));
}

async function customSave(model, dir) {
  mkdirSync(dir, { recursive: true });
  await model.save({
    save: async (artifacts) => {
      const wd = artifacts.weightData;
      const bytes = wd instanceof ArrayBuffer ? new Uint8Array(wd) : new Uint8Array(wd.buffer ?? wd);
      writeFileSync(join(dir, 'weights.bin'), Buffer.from(bytes));
      const modelJSON = {
        modelTopology: artifacts.modelTopology,
        format: artifacts.format ?? 'layers-model',
        generatedBy: 'neuro-image-enhancer/training',
        convertedBy: null,
        weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
      };
      writeFileSync(join(dir, 'model.json'), JSON.stringify(modelJSON));
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    },
  });
}

async function evaluate(model, scales) {
  const [input, clean] = genBatch(64, SIZE, 0); // degraded-only → measures correction
  const baseline = (await mse(input, clean).data())[0];
  const recon = tf.tidy(() => {
    const out = model.predict(input);
    return applyAdjustments(input, tf.exp(tf.mul(out, scales)));
  });
  const corrected = (await mse(recon, clean).data())[0];
  input.dispose();
  clean.dispose();
  recon.dispose();
  return { baseline, corrected };
}

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();
  console.log(`backend=${tf.getBackend()}  steps=${STEPS} batch=${BATCH} size=${SIZE}`);

  const model = buildModel(SIZE);
  const params = model.countParams();
  console.log(`model params: ${params}`);

  const optimizer = tf.train.adam(LR);
  const scales = tf.tensor1d([0.7, 0.5, 0.7]); // kept across steps

  const t0 = Date.now();
  for (let step = 1; step <= STEPS; step++) {
    const [input, clean] = genBatch(BATCH, SIZE);
    const lossT = optimizer.minimize(
      () => {
        const out = model.apply(input, { training: true });
        const recon = applyAdjustments(input, tf.exp(tf.mul(out, scales)));
        const reconLoss = tf.mean(tf.square(tf.sub(recon, clean)));
        const reg = tf.mul(tf.mean(tf.square(out)), 5e-4); // discourage extremes
        return tf.add(reconLoss, reg);
      },
      /* returnCost */ true,
    );
    const loss = (await lossT.data())[0];
    lossT.dispose();
    input.dispose();
    clean.dispose();

    if (step % 50 === 0 || step === 1) {
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`step ${step}/${STEPS}  loss=${loss.toFixed(5)}  (${secs}s, tensors=${tf.memory().numTensors})`);
    }
  }

  const ev = await evaluate(model, scales);
  console.log(
    `eval MSE  baseline(no-op)=${ev.baseline.toFixed(5)}  corrected=${ev.corrected.toFixed(5)}  ` +
      `improvement=${(((ev.baseline - ev.corrected) / ev.baseline) * 100).toFixed(1)}%`,
  );

  await customSave(model, OUT_DIR);
  const jsonKb = (statSync(join(OUT_DIR, 'model.json')).size / 1024).toFixed(1);
  const binKb = (statSync(join(OUT_DIR, 'weights.bin')).size / 1024).toFixed(1);
  console.log(`saved → ${OUT_DIR}  (model.json ${jsonKb} KB, weights.bin ${binKb} KB)`);

  scales.dispose();
  optimizer.dispose();
  model.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
