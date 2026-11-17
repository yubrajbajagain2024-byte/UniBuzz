/**
 * The camera's beauty filters: three looks a person can put on a photo before taking it (the app's camera draws them
 * live and saves the photo with them, see apps/mobile/src/lib/beauty-gl.ts). A look is only numbers here: how much the
 * skin is smoothed, how the light and the colours shift. Nothing about a face is detected, reshaped or stored: every
 * look softens skin-coloured areas a little and adjusts tone, and at intensity 0 it is the photo as the camera took it.
 */

export type BeautyFilterId = "natural" | "warm" | "bright";

/**
 * What a look does, each amount as the shader takes it. `smooth` is how far skin moves towards its edge-keeping blur (0
 * none, 1 all of it); `brighten` lifts the midtones; `warmth` shifts the white balance towards amber (negative: cooler);
 * `saturation` and `contrast` are changes from 1 (0 leaves them alone); `glow` is the soft light laid over the picture.
 */
export type BeautyLook = { smooth: number; brighten: number; warmth: number; saturation: number; glow: number; contrast: number };

export type BeautyFilter = { id: BeautyFilterId; name: string; hint: string; look: BeautyLook };

/** A look with nothing in it: the picture as it is. */
export const NO_BEAUTY: BeautyLook = { smooth: 0, brighten: 0, warmth: 0, saturation: 0, glow: 0, contrast: 0 };

/**
 * How much smoothing a look may ever ask for. Skin keeps part of its own texture at any setting, so a face is softened,
 * never blurred flat, and nothing that is not skin-coloured (eyes, hair, the room) is smoothed by more than a trace.
 */
export const BEAUTY_SMOOTH_MAX = 0.8;

/** The looks at full intensity, in the order the camera shows them. */
export const BEAUTY_FILTERS: readonly BeautyFilter[] = [
  { id: "natural", name: "Natural Glow", hint: "Soft, smooth skin with natural colours", look: { smooth: 0.74, brighten: 0.1, warmth: 0, saturation: 0.04, glow: 0.12, contrast: -0.03 } },
  { id: "warm", name: "Warm Beauty", hint: "Gentle smoothing with warm, flattering tones", look: { smooth: 0.64, brighten: 0.08, warmth: 0.55, saturation: 0.08, glow: 0.1, contrast: -0.02 } },
  { id: "bright", name: "Bright Radiance", hint: "Brighter, clearer skin with soft, luminous light", look: { smooth: 0.7, brighten: 0.3, warmth: 0.06, saturation: 0.02, glow: 0.3, contrast: -0.05 } },
];

/** Where the intensity slider starts: clearly there, short of the most a look can do. */
export const BEAUTY_DEFAULT_INTENSITY = 0.65;

export function isBeautyFilterId(value: unknown): value is BeautyFilterId {
  return typeof value === "string" && BEAUTY_FILTERS.some((f) => f.id === value);
}

export function beautyFilter(id: BeautyFilterId): BeautyFilter {
  return BEAUTY_FILTERS.find((f) => f.id === id) ?? BEAUTY_FILTERS[0]!;
}

/** An intensity as the slider keeps it: 0 to 1, anything else (a stored value gone wrong) the default. */
export function clampBeautyIntensity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return BEAUTY_DEFAULT_INTENSITY;
  return Math.min(1, Math.max(0, value));
}

/**
 * The look to draw for a filter at an intensity (0 to 1): every amount scaled by it, so the slider moves the whole look
 * together and 0 is the untouched picture. No filter is NO_BEAUTY.
 */
export function beautyLook(id: BeautyFilterId | null, intensity: number): BeautyLook {
  if (!id) return NO_BEAUTY;
  const t = clampBeautyIntensity(intensity);
  const full = beautyFilter(id).look;
  return {
    smooth: Math.min(BEAUTY_SMOOTH_MAX, full.smooth * t),
    brighten: full.brighten * t,
    warmth: full.warmth * t,
    saturation: full.saturation * t,
    glow: full.glow * t,
    contrast: full.contrast * t,
  };
}

/** The intensity as people read it on the slider: a whole number from 0 to 100. */
export function beautyPercent(intensity: number): number {
  return Math.round(clampBeautyIntensity(intensity) * 100);
}

// -----------------------------------------------------------------------------
// Drawing: where the picture sits in its view, and how far the smoothing reaches
// -----------------------------------------------------------------------------
/**
 * How a picture is laid into the quad that draws it, as the shader takes it: a point (x, y) of the quad, each 0 to 1,
 * reads the picture at (x * sx + ox, y * sy + oy).
 */
export type BeautyCrop = { sx: number; sy: number; ox: number; oy: number };

/** The whole picture, as it is. */
export const BEAUTY_WHOLE: BeautyCrop = { sx: 1, sy: 1, ox: 0, oy: 0 };

/**
 * A picture filling a view of another shape, cropped evenly at the sides it overflows (as the camera's own preview fills
 * its stage), optionally mirrored (`flipX`) or turned upside down (`flipY`: a picture whose first row is its top, drawn
 * by a quad whose y runs upward). Aspects are width over height; a shape that is not a positive number leaves the
 * picture whole.
 */
export function beautyCoverCrop(pictureAspect: number, viewAspect: number, flipX = false, flipY = false): BeautyCrop {
  const sane = pictureAspect > 0 && viewAspect > 0 && Number.isFinite(pictureAspect) && Number.isFinite(viewAspect);
  const fx = sane && pictureAspect > viewAspect ? viewAspect / pictureAspect : 1;
  const fy = sane && pictureAspect < viewAspect ? pictureAspect / viewAspect : 1;
  return {
    sx: flipX ? -fx : fx,
    ox: flipX ? (1 + fx) / 2 : (1 - fx) / 2,
    sy: flipY ? -fy : fy,
    oy: flipY ? (1 + fy) / 2 : (1 - fy) / 2,
  };
}

/**
 * One step of the smoothing's reach, as a share of the short side of what is on show (the smoothing looks four steps
 * out). A share of the picture rather than a number of pixels, so a face is smoothed alike in the small live preview and
 * in the full-size photo.
 */
export const BEAUTY_STEP_SHARE = 0.004;

/**
 * That step in the picture's own coordinates (0 to 1 each way), for a picture `width` by `height` pixels of which `crop`
 * is on show.
 */
export function beautyStep(width: number, height: number, crop: BeautyCrop = BEAUTY_WHOLE): { x: number; y: number } {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  const shown = Math.min(Math.abs(crop.sx) * width, Math.abs(crop.sy) * height);
  const pixels = BEAUTY_STEP_SHARE * shown;
  return { x: pixels / width, y: pixels / height };
}
