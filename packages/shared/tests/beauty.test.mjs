// Unit tests for the camera's beauty filters (src/beauty.ts): the looks and how the intensity scales them. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { BEAUTY_DEFAULT_INTENSITY, BEAUTY_FILTERS, BEAUTY_SMOOTH_MAX, BEAUTY_STEP_SHARE, BEAUTY_WHOLE, NO_BEAUTY, beautyCoverCrop, beautyFilter, beautyLook, beautyPercent, beautyStep, clampBeautyIntensity, isBeautyFilterId } from "../src/beauty.ts";

test("three looks, in the camera's order, each with a name and a hint", () => {
  assert.deepEqual(BEAUTY_FILTERS.map((f) => f.id), ["natural", "warm", "bright"]);
  assert.deepEqual(BEAUTY_FILTERS.map((f) => f.name), ["Natural Glow", "Warm Beauty", "Bright Radiance"]);
  for (const f of BEAUTY_FILTERS) assert.ok(f.hint.length > 10, f.id);
});

test("no filter, or intensity 0, is the picture as it is", () => {
  assert.deepEqual(beautyLook(null, 1), NO_BEAUTY);
  for (const f of BEAUTY_FILTERS) {
    const look = beautyLook(f.id, 0);
    // -0 (a negative amount times 0) is as much "nothing" as 0.
    for (const [key, value] of Object.entries(look)) assert.equal(Math.abs(value), 0, `${f.id}.${key}`);
  }
});

test("the intensity scales the whole look together", () => {
  for (const f of BEAUTY_FILTERS) {
    const half = beautyLook(f.id, 0.5);
    const full = beautyLook(f.id, 1);
    for (const key of Object.keys(full)) {
      assert.ok(Math.abs(half[key] - full[key] / 2) < 1e-9, `${f.id}.${key}`);
      assert.ok(Math.abs(full[key] - f.look[key]) < 1e-9, `${f.id}.${key} at full`);
    }
  }
});

test("smoothing never passes its cap, so skin is softened and not blurred flat", () => {
  for (const f of BEAUTY_FILTERS) {
    assert.ok(f.look.smooth <= BEAUTY_SMOOTH_MAX, f.id);
    assert.ok(beautyLook(f.id, 5).smooth <= BEAUTY_SMOOTH_MAX, `${f.id} past the slider's end`);
    assert.ok(f.look.smooth > 0.5, `${f.id} still smooths`);
  }
});

test("each look is what its name says", () => {
  const natural = beautyFilter("natural").look;
  const warm = beautyFilter("warm").look;
  const bright = beautyFilter("bright").look;
  assert.equal(natural.warmth, 0, "Natural Glow keeps the colours as they are");
  assert.ok(warm.warmth > natural.warmth && warm.warmth > bright.warmth, "Warm Beauty is the warm one");
  assert.ok(bright.brighten > natural.brighten && bright.brighten > warm.brighten, "Bright Radiance is the bright one");
  assert.ok(bright.glow > natural.glow && bright.glow > warm.glow, "and the most luminous");
  assert.ok(warm.smooth < natural.smooth, "Warm Beauty smooths the most gently");
});

test("intensities are kept in range, and nonsense falls back to the default", () => {
  assert.equal(clampBeautyIntensity(-1), 0);
  assert.equal(clampBeautyIntensity(2), 1);
  assert.equal(clampBeautyIntensity(0.4), 0.4);
  assert.equal(clampBeautyIntensity(Number.NaN), BEAUTY_DEFAULT_INTENSITY);
  assert.equal(clampBeautyIntensity("0.9"), BEAUTY_DEFAULT_INTENSITY);
  assert.equal(clampBeautyIntensity(undefined), BEAUTY_DEFAULT_INTENSITY);
  assert.equal(beautyPercent(0.654), 65);
  assert.equal(beautyPercent(7), 100);
});

test("filter ids are told from anything else (a stored choice read back)", () => {
  assert.ok(isBeautyFilterId("warm"));
  assert.ok(!isBeautyFilterId("sepia"));
  assert.ok(!isBeautyFilterId(null));
  assert.ok(!isBeautyFilterId(3));
});

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test("beautyCoverCrop: a picture wider than its view loses its sides evenly, a taller one its top and bottom", () => {
  // A 3:4 camera frame in a 9:16 stage: three quarters of its width shows, all of its height.
  const wide = beautyCoverCrop(3 / 4, 9 / 16);
  near(wide.sx, 0.75, "sx");
  near(wide.ox, 0.125, "ox");
  near(wide.sy, 1, "sy");
  near(wide.oy, 0, "oy");
  // A 9:16 frame in a 3:4 view: all of its width, three quarters of its height.
  const tall = beautyCoverCrop(9 / 16, 3 / 4);
  near(tall.sx, 1, "sx");
  near(tall.sy, 0.75, "sy");
  near(tall.oy, 0.125, "oy");
  assert.deepEqual(beautyCoverCrop(1, 1), BEAUTY_WHOLE, "the same shape shows whole");
});

test("beautyCoverCrop: flips read the same part of the picture, the other way round", () => {
  const plain = beautyCoverCrop(3 / 4, 9 / 16);
  const mirrored = beautyCoverCrop(3 / 4, 9 / 16, true, true);
  // The quad's left edge reads what its right edge read, and so top and bottom.
  near(mirrored.ox, plain.sx + plain.ox, "left edge");
  near(mirrored.sx + mirrored.ox, plain.ox, "right edge");
  near(mirrored.oy, plain.sy + plain.oy, "bottom edge");
  near(mirrored.sy + mirrored.oy, plain.oy, "top edge");
});

test("beautyCoverCrop: a shape that makes no sense leaves the picture whole", () => {
  assert.deepEqual(beautyCoverCrop(0, 1), BEAUTY_WHOLE);
  assert.deepEqual(beautyCoverCrop(Number.NaN, 0.5), BEAUTY_WHOLE);
  assert.deepEqual(beautyCoverCrop(1, -2), BEAUTY_WHOLE);
});

test("beautyStep: the same share of what is on show, in the preview and in the photo", () => {
  // The whole of a 1080 x 1920 photo: a step is that share of its 1080.
  const photo = beautyStep(1080, 1920);
  near(photo.x * 1080, BEAUTY_STEP_SHARE * 1080, "photo x");
  near(photo.y * 1920, BEAUTY_STEP_SHARE * 1080, "photo y, the same pixels");
  // A 1440 x 1920 frame of which the middle 1080 shows: the step is still that share of 1080.
  const preview = beautyStep(1440, 1920, beautyCoverCrop(3 / 4, 9 / 16));
  near(preview.x * 1440, BEAUTY_STEP_SHARE * 1080, "preview x");
  near(preview.y * 1920, BEAUTY_STEP_SHARE * 1080, "preview y");
  assert.deepEqual(beautyStep(0, 100), { x: 0, y: 0 }, "no size, no reach");
});
