import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { BeautyLook } from "@apartment-book/shared";
import { createBeautyRenderer, expoGL } from "./beauty-gl";

/**
 * The longest side a photo is filtered at: what a post keeps anyway (compose-media's PHOTO_EDGE), and well inside what
 * any phone's GPU draws in one piece.
 */
const BEAUTY_EDGE = 2160;
const BEAUTY_QUALITY = 0.92;

/**
 * The photo's first row (its top) is the texture's first, and is drawn into the target's first row. A snapshot takes the
 * target's first row for the picture's bottom, as GL has it, unless it is told to flip: so it is, on iOS and Android
 * alike (expo-gl's two snapshot writers agree on this; seen upright on iOS, 2026-11-16).
 */
const SNAPSHOT_FLIP = true;

export type BeautyPhoto = { uri: string; width: number; height: number };

/**
 * A photo just taken, with a beauty look laid on it: the very shader the live preview draws (lib/beauty-gl.ts), run once
 * over the whole photo off the screen, and saved as a new JPEG beside the camera's own. The photo is first made an
 * upright JPEG no longer than BEAUTY_EDGE (the GPU reads the file's pixels as they lie, without its orientation tag).
 * Throws if the photo could not be read or drawn: the caller keeps the camera's own photo then.
 */
export async function applyBeautyToPhoto(shot: BeautyPhoto, look: BeautyLook): Promise<BeautyPhoto> {
  const context = ImageManipulator.manipulate(shot.uri);
  if (Math.max(shot.width, shot.height) > BEAUTY_EDGE) context.resize(shot.width >= shot.height ? { width: BEAUTY_EDGE } : { height: BEAUTY_EDGE });
  const rendered = await context.renderAsync();
  const upright = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.97 });
  if (!upright.uri || !(upright.width > 0) || !(upright.height > 0)) throw new Error("Could not read the photo");
  const { width, height } = upright;

  const { GLView } = expoGL();
  const gl = await GLView.createContextAsync();
  try {
    if (Math.max(width, height) > (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)) throw new Error("The photo is too large to filter on this phone");
    const renderer = createBeautyRenderer(gl);
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not load the photo");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // expo-gl reads a local file's pixels straight into the texture.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri: upright.uri } as unknown as TexImageSource);
    const loaded = renderer.sizeOf(texture);
    if (!loaded || loaded.width !== width || loaded.height !== height) throw new Error("Could not load the photo");
    const target = renderer.createTarget(width, height);
    renderer.draw(texture, { look, width, height, target, viewport: { x: 0, y: 0, width, height } });
    // expo-gl queues what is asked of it: the target and the drawing exist on the GPU only once the queue has run, and
    // the snapshot reads the GPU. flushEXP runs the queue and waits for it.
    gl.flushEXP();
    const snapshot = await GLView.takeSnapshotAsync(gl, { framebuffer: target.framebuffer, rect: { x: 0, y: 0, width, height }, format: "jpeg", compress: BEAUTY_QUALITY, flip: SNAPSHOT_FLIP });
    if (!snapshot.localUri) throw new Error("Could not save the photo");
    return { uri: snapshot.localUri, width: snapshot.width || width, height: snapshot.height || height };
  } finally {
    void GLView.destroyContextAsync(gl);
  }
}
