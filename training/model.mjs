// Tiny CNN "global parameter regressor": downsampled image → 3 scalars
// (brightness, contrast, saturation), each a tanh output in [-1, 1].
// ~16k parameters → ~65 KB float32 weights. Must match MODEL_INPUT_SIZE in
// src/ml/model.ts and the 3-output mapping in src/shared/params.ts.
import * as tfl from '@tensorflow/tfjs-layers';

export function buildModel(size = 64) {
  const m = tfl.sequential();
  m.add(
    tfl.layers.conv2d({
      inputShape: [size, size, 3],
      filters: 8,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    }),
  );
  m.add(tfl.layers.maxPooling2d({ poolSize: 2 })); // 32
  m.add(tfl.layers.conv2d({ filters: 16, kernelSize: 3, padding: 'same', activation: 'relu' }));
  m.add(tfl.layers.maxPooling2d({ poolSize: 2 })); // 16
  m.add(tfl.layers.conv2d({ filters: 32, kernelSize: 3, padding: 'same', activation: 'relu' }));
  m.add(tfl.layers.maxPooling2d({ poolSize: 2 })); // 8
  m.add(tfl.layers.conv2d({ filters: 32, kernelSize: 3, padding: 'same', activation: 'relu' }));
  m.add(tfl.layers.globalAveragePooling2d({}));
  m.add(tfl.layers.dense({ units: 24, activation: 'relu' }));
  m.add(tfl.layers.dense({ units: 3, activation: 'tanh' }));
  return m;
}
