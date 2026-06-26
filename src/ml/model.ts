import { loadLayersModel, type LayersModel } from '@tensorflow/tfjs-layers';
import { tf } from './backend';
import { outputsToAdjustments, type Adjustments } from '../shared/params';

/** Side length the model expects (must match the trained model / training script). */
export const MODEL_INPUT_SIZE = 64;

/**
 * Wraps the trained TF.js LayersModel. Input: an `MODEL_INPUT_SIZE²` RGBA
 * thumbnail. Output: three tanh scalars in [-1, 1] that map to multiplicative
 * brightness / contrast / saturation factors via {@link outputsToAdjustments}.
 */
export class EnhanceModel {
  private constructor(
    private readonly model: LayersModel,
    readonly inputSize: number,
  ) {}

  static async load(url: string, inputSize = MODEL_INPUT_SIZE): Promise<EnhanceModel> {
    const model = await loadLayersModel(url);
    return new EnhanceModel(model, inputSize);
  }

  /** Run inference on a square RGBA thumbnail. */
  predict(thumb: ImageData): Adjustments {
    const out = tf.tidy(() => {
      const n = thumb.width * thumb.height;
      const f = new Float32Array(n * 3);
      const d = thumb.data;
      for (let i = 0, j = 0; i < n; i++) {
        f[j++] = d[i * 4] / 255;
        f[j++] = d[i * 4 + 1] / 255;
        f[j++] = d[i * 4 + 2] / 255;
      }
      const x = tf.tensor4d(f, [1, thumb.height, thumb.width, 3]);
      const y = this.model.predict(x) as tf.Tensor;
      return y.dataSync();
    });
    return outputsToAdjustments([out[0] ?? 0, out[1] ?? 0, out[2] ?? 0]);
  }

  dispose(): void {
    this.model.dispose();
  }
}
