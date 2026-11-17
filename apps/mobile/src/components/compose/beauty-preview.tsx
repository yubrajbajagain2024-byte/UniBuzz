import { useCallback, useEffect, useRef, type ComponentRef } from "react";
import { StyleSheet, type LayoutChangeEvent, type ViewStyle } from "react-native";
import type { CameraView } from "expo-camera";
import type { ExpoWebGLRenderingContext, GLView as GLViewType } from "expo-gl";
import { beautyCoverCrop, type BeautyLook } from "@apartment-book/shared";
import { createBeautyRenderer, expoGL, type BeautyRenderer } from "@/lib/beauty-gl";

/**
 * The camera's live picture with a beauty look on it, drawn over the camera's own preview: the camera's frames become a
 * texture (expo-gl's createCameraTextureAsync, which adds a second output to the very session the camera is running),
 * and each is drawn through the same shader that filters the photo (lib/beauty-gl.ts), so what is on screen is what
 * the photo will be.
 *
 * The camera's frames arrive upright and mirrored, whichever lens is in use. The back lens therefore needs mirroring
 * back; the front one is left as it is, as the camera's own preview mirrors a selfie (CameraView `mirror`). A frame is
 * laid into the stage the way the camera's preview fills it: the middle of it, cropped at the sides it overflows.
 *
 * `look` is read through a ref: the loop draws every frame from it, so moving the slider or changing filter shows at
 * once without the loop being built again. Nothing is drawn until the camera has sent a frame (the texture has no size
 * before that), so the camera's own preview shows underneath meanwhile and the picture never flashes.
 */
export function BeautyPreview({ camera, look, facing, style, onReady, onError }: { camera: ComponentRef<typeof CameraView> | null; look: BeautyLook; facing: "front" | "back"; style?: ViewStyle; onReady?: () => void; onError?: (message: string) => void }) {
  const { GLView } = expoGL();
  const view = useRef<GLViewType | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const lookRef = useRef(look);
  lookRef.current = look;
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const alive = useRef(true);
  const told = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    size.current = e.nativeEvent.layout;
  }, []);

  const onContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      let renderer: BeautyRenderer;
      let texture: WebGLTexture;
      try {
        if (!view.current || !camera) return;
        renderer = createBeautyRenderer(gl);
        texture = await view.current.createCameraTextureAsync(camera);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "The filter could not start");
        return;
      }
      const drawable = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
      const frame = () => {
        if (!alive.current) return;
        const shape = renderer.sizeOf(texture);
        if (shape) {
          const viewSize = size.current.width > 0 ? size.current : drawable;
          // The frames come mirrored: the back lens is turned back, the front one is left (the preview mirrors a selfie).
          const crop = beautyCoverCrop(shape.width / shape.height, viewSize.width / viewSize.height, facingRef.current === "back", true);
          renderer.draw(texture, { look: lookRef.current, width: shape.width, height: shape.height, crop, target: null, viewport: { x: 0, y: 0, width: drawable.width, height: drawable.height } });
          gl.endFrameEXP();
          if (!told.current) {
            told.current = true;
            onReady?.();
          }
        }
        requestAnimationFrame(frame);
      };
      frame();
    },
    [camera, onReady, onError],
  );

  return <GLView ref={view} style={[StyleSheet.absoluteFill, style]} onLayout={onLayout} onContextCreate={onContextCreate} pointerEvents="none" />;
}
