import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { ExpoWebGLRenderingContext } from "expo-gl";
import { BEAUTY_WHOLE, beautyStep, type BeautyCrop, type BeautyLook } from "@apartment-book/shared";

/**
 * The camera's beauty filters, drawn on the GPU (expo-gl): one shader for the live preview and for the photo that is
 * saved, so a photo comes out as it looked. The looks themselves are numbers in packages/shared (src/beauty.ts).
 *
 * expo-gl is a native module: a build made before it was added does not have it (and an update read over the air by
 * such a build must not touch it), so nothing here is imported at the top. `BEAUTY_AVAILABLE` says whether this build
 * has it; without it the camera simply shows no filters.
 */
export const BEAUTY_AVAILABLE = (() => {
  try {
    return Boolean(requireOptionalNativeModule("ExpoGL"));
  } catch {
    return false;
  }
})();

/**
 * Whether the filter is drawn live over the camera (a GL view fed the camera's own frames, see BeautyPreview). On iOS,
 * read from expo-gl's and expo-camera's source (2026-11-16) and to be confirmed on a phone; not on Android yet, where it
 * could not be built or tried: there the filter is applied as the photo is taken.
 */
export const BEAUTY_LIVE = BEAUTY_AVAILABLE && Platform.OS === "ios";

/** expo-gl, loaded only when it is there and asked for. */
export function expoGL(): typeof import("expo-gl") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-gl") as typeof import("expo-gl");
}

const VERTEX = `#version 300 es
in vec2 aPos;
uniform vec4 uCrop;
out vec2 vUv;
void main() {
  vUv = aPos * uCrop.xy + uCrop.zw;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * The look. Skin is smoothed by an edge-keeping (bilateral) blur: thirty-two samples in four rings round each pixel,
 * each counted less the more its colour differs from the pixel's own, so blemishes and pores even out while the edges
 * of eyes, lips, hair and the face itself stay where they are and as sharp as they were. It is laid on in full only
 * where the colour is a skin tone (any skin tone: the test is on the colour's hue, not its lightness), and a fifth of
 * the skin's own texture is kept, so a face is softened, never painted flat or reshaped. Then the light: a soft glow
 * (the picture's own blur screened over it), a lift of the midtones (a touch more on skin), the white balance, and a
 * little saturation and contrast.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSmooth;
uniform float uBrighten;
uniform float uWarmth;
uniform float uSaturation;
uniform float uGlow;
uniform float uContrast;
in vec2 vUv;
out vec4 outColor;

const vec2 RING_A[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071), vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
const vec2 RING_B[8] = vec2[8](vec2(0.9239, 0.3827), vec2(0.3827, 0.9239), vec2(-0.3827, 0.9239), vec2(-0.9239, 0.3827), vec2(-0.9239, -0.3827), vec2(-0.3827, -0.9239), vec2(0.3827, -0.9239), vec2(0.9239, -0.3827));
// How fast a sample stops counting as its colour moves away from the pixel's: a blemish (a few hundredths) still
// counts, an edge (two tenths) does not.
const float RANGE = 48.0;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// 1 where the colour is a skin tone, 0 where it is not, soft between: the chroma range skin of every shade falls in.
float skin(vec3 c) {
  float y = luma(c);
  float cb = 0.5 + (c.b - y) * 0.564;
  float cr = 0.5 + (c.r - y) * 0.713;
  float tone = smoothstep(0.27, 0.34, cb) * (1.0 - smoothstep(0.50, 0.56, cb)) * smoothstep(0.50, 0.535, cr) * (1.0 - smoothstep(0.70, 0.76, cr));
  return tone * smoothstep(0.05, 0.16, y);
}

void main() {
  vec3 c = texture(uTex, vUv).rgb;
  vec3 sum = c;
  float weight = 1.0;
  vec3 mean = c;
  for (int ring = 1; ring <= 4; ring++) {
    float r = float(ring);
    float near = exp(-r * r / 9.0);
    for (int k = 0; k < 8; k++) {
      vec2 dir = (ring == 1 || ring == 3) ? RING_A[k] : RING_B[k];
      vec3 s = texture(uTex, vUv + dir * r * uStep).rgb;
      vec3 d = s - c;
      float w = near * exp(-dot(d, d) * RANGE);
      sum += s * w;
      weight += w;
      mean += s;
    }
  }
  vec3 soft = sum / weight;
  mean /= 33.0;

  float mask = skin(soft);
  float amount = uSmooth * mix(0.22, 1.0, mask);
  vec3 col = mix(c, soft + (c - soft) * 0.2, amount);

  col += uGlow * 0.4 * mean * (1.0 - col);
  col += uBrighten * (1.0 + 0.5 * mask) * 1.2 * col * (1.0 - col);
  col *= vec3(1.0 + 0.085 * uWarmth, 1.0 + 0.012 * uWarmth, 1.0 - 0.095 * uWarmth);
  col = mix(vec3(luma(col)), col, 1.0 + uSaturation);
  col = (col - 0.5) * (1.0 + uContrast) + 0.5;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Writes a texture's size into one pixel (each of width and height as two bytes), for JS to read back. */
const SIZE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  ivec2 s = textureSize(uTex, 0);
  outColor = vec4(float(s.x % 256), float(s.x / 256), float(s.y % 256), float(s.y / 256)) / 255.0;
}`;

type GL = ExpoWebGLRenderingContext;

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`The filter's shader did not compile: ${log}`);
  }
  return shader;
}

function link(gl: GL, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create a program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`The filter's program did not link: ${gl.getProgramInfoLog(program) ?? ""}`);
  return program;
}

/** A picture to draw into, off the screen: a framebuffer and the texture behind it. */
export type BeautyTarget = { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };

export type BeautyDraw = {
  look: BeautyLook;
  /** The picture's size in pixels (the smoothing's reach is a share of it, see beautyStep). */
  width: number;
  height: number;
  /** Which part of the picture goes into the viewport, and which way round. The whole of it, by default. */
  crop?: BeautyCrop;
  /** Where to draw: a target off the screen, or (null) the view itself. */
  target: BeautyTarget | null;
  /** The part of the target (or view) drawn into, in pixels. */
  viewport: { x: number; y: number; width: number; height: number };
};

export type BeautyRenderer = {
  /** Draws `texture` through a look. */
  draw(texture: WebGLTexture, o: BeautyDraw): void;
  /** The size of a texture as the GPU has it (null while it has none, such as a camera that has sent no frame yet). */
  sizeOf(texture: WebGLTexture): { width: number; height: number } | null;
  /** A picture to draw into, `width` by `height` pixels. */
  createTarget(width: number, height: number): BeautyTarget;
};

/**
 * The renderer for one GL context: the look's program, a one-pixel probe that reads a texture's size, and a quad. Every
 * texture is drawn with linear sampling and clamped edges, set at each draw: the camera hands over a new texture for
 * every frame.
 */
export function createBeautyRenderer(gl: GL): BeautyRenderer {
  const program = link(gl, VERTEX, FRAGMENT);
  const probe = link(gl, VERTEX, SIZE_FRAGMENT);
  const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const at = {
    tex: u(program, "uTex"),
    crop: u(program, "uCrop"),
    step: u(program, "uStep"),
    smooth: u(program, "uSmooth"),
    brighten: u(program, "uBrighten"),
    warmth: u(program, "uWarmth"),
    saturation: u(program, "uSaturation"),
    glow: u(program, "uGlow"),
    contrast: u(program, "uContrast"),
    probeTex: u(probe, "uTex"),
    probeCrop: u(probe, "uCrop"),
  };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const bind = (texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const quadOn = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  };
  const createTarget = (width: number, height: number): BeautyTarget => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("Could not make room for the picture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture, width, height };
  };
  const pixel = createTarget(1, 1);
  const read = new Uint8Array(4);

  return {
    createTarget,
    draw(texture, o) {
      const crop = o.crop ?? BEAUTY_WHOLE;
      const step = beautyStep(o.width, o.height, crop);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.target ? o.target.framebuffer : null);
      gl.viewport(o.viewport.x, o.viewport.y, o.viewport.width, o.viewport.height);
      gl.useProgram(program);
      bind(texture);
      quadOn();
      gl.uniform1i(at.tex, 0);
      gl.uniform4f(at.crop, crop.sx, crop.sy, crop.ox, crop.oy);
      gl.uniform2f(at.step, step.x, step.y);
      gl.uniform1f(at.smooth, o.look.smooth);
      gl.uniform1f(at.brighten, o.look.brighten);
      gl.uniform1f(at.warmth, o.look.warmth);
      gl.uniform1f(at.saturation, o.look.saturation);
      gl.uniform1f(at.glow, o.look.glow);
      gl.uniform1f(at.contrast, o.look.contrast);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    sizeOf(texture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pixel.framebuffer);
      gl.viewport(0, 0, 1, 1);
      gl.useProgram(probe);
      bind(texture);
      quadOn();
      gl.uniform1i(at.probeTex, 0);
      gl.uniform4f(at.probeCrop, 1, 1, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, read);
      const width = read[0]! + read[1]! * 256;
      const height = read[2]! + read[3]! * 256;
      // Nothing behind the texture yet reads as nothing, or as the one pixel an empty texture has.
      return width > 8 && height > 8 ? { width, height } : null;
    },
  };
}
