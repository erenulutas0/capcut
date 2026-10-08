/**
 * "İyileştir" on the GPU (ADR-037): the formulas of `domain/enhance.ts` as
 * WebGL2 fragment shaders, run on an `OffscreenCanvas` inside the export
 * worker.
 *
 * Up to three passes, each reading whole pixels (`texelFetch`, no filtering):
 *
 *   noise filter -> light and colour -> sharpening
 *
 * A pass that has nothing to do for a frame is not run at all. Whichever
 * pass is last writes the canvas; there the pixels outside the picture
 * rectangle (the bars of a "Sığdır" frame) are copied from the source
 * unchanged. Intermediate pictures are half-float where the browser can
 * render to it, so nothing is rounded to 8 bits before the last step.
 *
 * The shader sources are plain strings compiled by WebGL: no inline script,
 * no `eval`, nothing a strict Content-Security-Policy objects to.
 *
 * This is the same maths as the reference renderer, not a second design:
 * `enhanceCheck.ts` renders a test picture through both before every use and
 * the GPU path is only taken when the two agree.
 */

import {
  DENOISE_TAPS,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  SHOULDER_KNEE,
  shoulderOf,
  toneIsNeutral,
  toneStageIsNeutral,
  type EnhanceParams,
  type PictureRect,
} from '@/domain/enhance';

/** A number as a GLSL float literal (always with a decimal point or an exponent). */
const glsl = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the whole target.
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPicture;
// The frame as it came in: what the pixels outside the picture rectangle keep.
uniform sampler2D uSource;
// The picture rectangle in pixels: x0, y0, x1, y1 (inclusive).
uniform ivec4 uRect;
// Height of the target when it is the canvas (rows run bottom-up there); 0 for an intermediate picture.
uniform int uFlipHeight;
out vec4 outColor;
const vec3 LUMA = vec3(${LUMA_R}, ${LUMA_G}, ${LUMA_B});
ivec2 here() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uFlipHeight > 0) p.y = uFlipHeight - 1 - p.y;
  return p;
}
vec3 pictureAt(ivec2 p) {
  return texelFetch(uPicture, clamp(p, uRect.xy, uRect.zw), 0).rgb;
}
// On the canvas, outside the picture: the frame's own bars, untouched. True when the pixel is done.
bool keptAsIs(ivec2 p) {
  if (uFlipHeight == 0) return false;
  if (p.x >= uRect.x && p.y >= uRect.y && p.x <= uRect.z && p.y <= uRect.w) return false;
  outColor = vec4(texelFetch(uSource, p, 0).rgb, 1.0);
  return true;
}
`;

const DENOISE = `${HEADER}
uniform float uFalloff;
const int TAPS = ${DENOISE_TAPS.length};
const ivec2 OFFSETS[TAPS] = ivec2[TAPS](${DENOISE_TAPS.map((tap) => `ivec2(${tap.dx}, ${tap.dy})`).join(', ')});
const float WEIGHTS[TAPS] = float[TAPS](${DENOISE_TAPS.map((tap) => glsl(tap.weight)).join(', ')});
void main() {
  ivec2 p = here();
  if (keptAsIs(p)) return;
  vec3 centre = pictureAt(p);
  float luma = dot(centre, LUMA);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < TAPS; i++) {
    vec3 other = pictureAt(p + OFFSETS[i]);
    float difference = dot(other, LUMA) - luma;
    float weight = WEIGHTS[i] * exp(-difference * difference * uFalloff);
    sum += weight * other;
    total += weight;
  }
  outColor = vec4(sum / total, 1.0);
}`;

const TONE = `${HEADER}
uniform float uBlack;
uniform float uGain;
uniform float uGamma;
uniform float uShoulder;
uniform vec3 uBalance;
uniform float uVibrance;
uniform int uTonal;
const float KNEE = ${glsl(SHOULDER_KNEE)};
vec3 decode(vec3 code) {
  vec3 c = clamp(code, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 encode(vec3 light) {
  vec3 l = clamp(light, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l));
}
float maxOf(vec3 v) { return max(v.r, max(v.g, v.b)); }
float minOf(vec3 v) { return min(v.r, min(v.g, v.b)); }
void main() {
  ivec2 p = here();
  if (keptAsIs(p)) return;
  vec3 rgb = decode(pictureAt(p));
  if (uBlack > 0.0) {
    float soft = 0.5 * uBlack;
    float white = 0.5 * (1.0 - uBlack + sqrt((1.0 - uBlack) * (1.0 - uBlack) + soft * soft));
    vec3 over = rgb - uBlack;
    rgb = 0.5 * (over + sqrt(over * over + soft * soft)) / white;
  }
  rgb *= uBalance;
  float light = dot(rgb, LUMA);
  float toned = min(1.0, light);
  if (uTonal == 1) {
    float value = max(0.0, light) * uGain;
    if (uGamma != 1.0) value = pow(value, uGamma);
    if (value > KNEE && uShoulder > 1.0) {
      float over = (value - KNEE) / (1.0 - KNEE);
      value = KNEE + ((1.0 - KNEE) * over) / (1.0 + (1.0 - 1.0 / uShoulder) * over);
    }
    toned = min(1.0, value);
  }
  rgb = light > 1e-6 ? rgb * (toned / light) : vec3(toned);
  if (uVibrance > 0.0) {
    float top = maxOf(rgb);
    float saturation = top > 1e-6 ? (top - minOf(rgb)) / top : 0.0;
    rgb = toned + (rgb - toned) * (1.0 + uVibrance * (1.0 - saturation));
  }
  // Back inside the gamut towards the pixel's own luminance.
  float top = maxOf(rgb);
  if (top > 1.0) rgb = toned + (rgb - toned) * (top - toned > 1e-6 ? (1.0 - toned) / (top - toned) : 0.0);
  float bottom = minOf(rgb);
  if (bottom < 0.0) rgb = toned + (rgb - toned) * (toned - bottom > 1e-6 ? toned / (toned - bottom) : 0.0);
  outColor = vec4(encode(rgb), 1.0);
}`;

const SHARPEN = `${HEADER}
uniform float uAmount;
uniform float uThreshold;
float lumaAt(ivec2 p) { return dot(pictureAt(p), LUMA); }
void main() {
  ivec2 p = here();
  if (keptAsIs(p)) return;
  vec3 colour = pictureAt(p);
  float delta = 0.0;
  {
    float centre = dot(colour, LUMA);
    float north = lumaAt(p + ivec2(0, -1));
    float south = lumaAt(p + ivec2(0, 1));
    float west = lumaAt(p + ivec2(-1, 0));
    float east = lumaAt(p + ivec2(1, 0));
    float corners = lumaAt(p + ivec2(-1, -1)) + lumaAt(p + ivec2(1, -1)) + lumaAt(p + ivec2(-1, 1)) + lumaAt(p + ivec2(1, 1));
    float blurred = (4.0 * centre + 2.0 * (north + south + west + east) + corners) / 16.0;
    float detail = centre - blurred;
    float size = abs(detail) - uThreshold;
    if (size > 0.0) {
      float wanted = centre + uAmount * (detail > 0.0 ? size : -size);
      float lowest = min(centre, min(min(north, south), min(west, east)));
      float highest = max(centre, max(max(north, south), max(west, east)));
      delta = clamp(wanted, lowest, highest) - centre;
    }
  }
  outColor = vec4(clamp(colour + delta, 0.0, 1.0), 1.0);
}`;

type Gl = WebGL2RenderingContext;

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

function compile(gl: Gl, fragment: string): Program | null {
  const build = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vertex = build(gl.VERTEX_SHADER, VERTEX);
  const frag = build(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vertex || !frag || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return { program, uniforms: new Map() };
}

function location(gl: Gl, program: Program, name: string): WebGLUniformLocation | null {
  if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.program, name));
  return program.uniforms.get(name) ?? null;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

/** What the picture is drawn from: the export's 2D canvas, or pixels (the self-check). */
export type EnhanceSource = OffscreenCanvas | ImageData;

/**
 * The GPU renderer for one frame size. `render` leaves the result on
 * `canvas`; the caller copies it wherever it is needed.
 */
export class GlEnhancer {
  readonly canvas: OffscreenCanvas;
  /** Whether intermediate pictures keep more than 8 bits. */
  readonly halfFloat: boolean;
  /** The renderer's own name where the browser tells it (a graphics card, or a software rasteriser), else null. */
  readonly renderer: string | null;
  private lost = false;

  private constructor(
    private readonly gl: Gl,
    canvas: OffscreenCanvas,
    private readonly width: number,
    private readonly height: number,
    private readonly source: WebGLTexture,
    private readonly targets: [Target, Target],
    private readonly programs: { denoise: Program; tone: Program; sharpen: Program },
    private readonly vertexArray: WebGLVertexArrayObject,
    halfFloat: boolean,
  ) {
    this.canvas = canvas;
    this.halfFloat = halfFloat;
    let renderer: string | null = null;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name: unknown = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      renderer = typeof name === 'string' && name ? name : null;
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
    });
  }

  /** Null where WebGL2 is missing or will not compile these shaders: the caller then uses the reference renderer. */
  static create(width: number, height: number): GlEnhancer | null {
    if (typeof OffscreenCanvas !== 'function') return null;
    let canvas: OffscreenCanvas;
    let gl: Gl | null;
    try {
      canvas = new OffscreenCanvas(width, height);
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
    } catch {
      return null;
    }
    if (!gl) return null;
    if (width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;

    const halfFloat = gl.getExtension('EXT_color_buffer_half_float') !== null || gl.getExtension('EXT_color_buffer_float') !== null;
    const texture = (internal: number, format: number, type: number): WebGLTexture | null => {
      const made = gl.createTexture();
      if (!made) return null;
      gl.bindTexture(gl.TEXTURE_2D, made);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return made;
    };
    const target = (float: boolean): Target | null => {
      const made = float ? texture(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const framebuffer = gl.createFramebuffer();
      if (!made || !framebuffer) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, made, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return complete ? { texture: made, framebuffer } : null;
    };

    const source = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    let float = halfFloat;
    let first = target(float);
    let second = target(float);
    if ((!first || !second) && float) {
      float = false;
      first = target(false);
      second = target(false);
    }
    const denoise = compile(gl, DENOISE);
    const tone = compile(gl, TONE);
    const sharpen = compile(gl, SHARPEN);
    const vertexArray = gl.createVertexArray();
    if (!source || !first || !second || !denoise || !tone || !sharpen || !vertexArray) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    gl.viewport(0, 0, width, height);
    return new GlEnhancer(gl, canvas, width, height, source, [first, second], { denoise, tone, sharpen }, vertexArray, float);
  }

  /**
   * Renders `picture` with `params` onto `this.canvas`. False when the GPU
   * context was lost or reported an error: the canvas must not be used then.
   */
  render(picture: EnhanceSource, params: EnhanceParams, rect: PictureRect): boolean {
    const { gl, width, height } = this;
    if (this.lost || gl.isContextLost()) return false;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, picture);

    const x0 = Math.min(Math.max(0, Math.round(rect.x)), width - 1);
    const y0 = Math.min(Math.max(0, Math.round(rect.y)), height - 1);
    const x1 = Math.min(width - 1, x0 + Math.max(1, Math.round(rect.width)) - 1);
    const y1 = Math.min(height - 1, y0 + Math.max(1, Math.round(rect.height)) - 1);
    gl.bindVertexArray(this.vertexArray);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.source);

    // The passes this frame needs, in order; the last one writes the canvas.
    // The light-and-colour pass also runs when nothing else does, so that
    // there is always one pass to put the frame on the canvas.
    const wanted: ('denoise' | 'tone' | 'sharpen')[] = [];
    if (params.denoise > 0) wanted.push('denoise');
    if (!toneStageIsNeutral(params) || (params.denoise <= 0 && params.sharpen <= 0)) wanted.push('tone');
    if (params.sharpen > 0) wanted.push('sharpen');

    let current: WebGLTexture = this.source;
    wanted.forEach((name, index) => {
      const last = index === wanted.length - 1;
      const output = last ? null : this.targets[index % 2 === 0 ? 0 : 1];
      const program = this.programs[name];
      gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.framebuffer : null);
      gl.useProgram(program.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, current);
      gl.uniform1i(location(gl, program, 'uPicture'), 0);
      gl.uniform1i(location(gl, program, 'uSource'), 1);
      gl.uniform4i(location(gl, program, 'uRect'), x0, y0, x1, y1);
      gl.uniform1i(location(gl, program, 'uFlipHeight'), output ? 0 : height);
      if (name === 'denoise') {
        gl.uniform1f(location(gl, program, 'uFalloff'), 1 / (2 * params.denoise * params.denoise));
      } else if (name === 'tone') {
        gl.uniform1f(location(gl, program, 'uBlack'), params.black);
        gl.uniform1f(location(gl, program, 'uGain'), params.gain);
        gl.uniform1f(location(gl, program, 'uGamma'), params.gamma);
        gl.uniform1f(location(gl, program, 'uShoulder'), shoulderOf(params));
        gl.uniform3f(location(gl, program, 'uBalance'), params.whiteBalance[0], params.whiteBalance[1], params.whiteBalance[2]);
        gl.uniform1f(location(gl, program, 'uVibrance'), params.vibrance);
        gl.uniform1i(location(gl, program, 'uTonal'), toneIsNeutral(params) ? 0 : 1);
      } else {
        gl.uniform1f(location(gl, program, 'uAmount'), params.sharpen);
        gl.uniform1f(location(gl, program, 'uThreshold'), params.sharpenThreshold);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (output) current = output.texture;
    });

    return !this.lost && !gl.isContextLost();
  }

  /** Reads the rendered canvas back (the self-check only; the export never reads pixels back). */
  read(): Uint8ClampedArray | null {
    const { gl, width, height } = this;
    if (this.lost || gl.isContextLost()) return null;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    const out = new Uint8ClampedArray(bottomUp.length);
    const row = width * 4;
    for (let y = 0; y < height; y += 1) out.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  }

  close(): void {
    this.lost = true;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
