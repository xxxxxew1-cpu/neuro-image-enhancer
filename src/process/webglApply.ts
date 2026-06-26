import type { Adjustments } from '../shared/params';

/**
 * GPU path: apply brightness/contrast/saturation to the full-resolution image
 * with a single fragment-shader pass. Matches `applyPixel` in
 * `src/shared/params.ts` exactly (order: brightness → contrast → saturation).
 *
 * Returns an OffscreenCanvas holding the result, or `null` when WebGL is
 * unavailable / the image is too large for the GPU — the caller then uses the
 * CPU fallback. GLSL is ES 1.00, accepted by both `webgl` and `webgl2`.
 */
// NOTE: we flip V in the shader (0.5 - a_pos.y*0.5 instead of +0.5). The
// texture-origin/convertToBlob combo otherwise renders the result upside-down
// vs. the source bitmap and the CPU path, and UNPACK_FLIP_Y_WEBGL is ignored by
// some drivers for ImageBitmap sources — flipping in the shader is reliable.
// Verified by scripts/diag-orient.mjs.
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  c *= u_brightness;                       // brightness (gain)
  c = (c - 0.5) * u_contrast + 0.5;        // contrast around mid-grey
  float l = dot(c, LUMA);                  // saturation around luma
  c = vec3(l) + (c - vec3(l)) * u_saturation;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function applyWebGL(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  adj: Adjustments,
): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(width, height);
  // `preserveDrawingBuffer` keeps the rendered pixels readable by
  // convertToBlob; `alpha:false` avoids premultiplied-alpha colour shifts.
  const opts: WebGLContextAttributes = { preserveDrawingBuffer: true, alpha: false };
  const gl = (canvas.getContext('webgl2', opts) ||
    canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
  if (!gl) return null;

  // Bail to CPU when the image exceeds the GPU's texture limit.
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (width > maxTex || height > maxTex) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  // Full-screen quad.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Texture from the decoded bitmap (flip Y so orientation matches the canvas).
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Orientation is handled in the vertex shader (see VERT) — do not also flip
  // on upload.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  } catch {
    return null;
  }

  gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_brightness'), adj.brightness);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_contrast'), adj.contrast);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_saturation'), adj.saturation);

  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Free GPU objects; the rendered pixels stay in the canvas backing store.
  gl.deleteTexture(tex);
  gl.deleteBuffer(buf);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (gl.getError() !== gl.NO_ERROR) return null;
  return canvas;
}
