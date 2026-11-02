import { StyleSheet, View } from "react-native";
import { Image, useImage, type ImageSource } from "expo-image";
import type { SharedRefType } from "expo";

/** A backdrop's picture is loaded only this many pixels wide, then blurred this much and stretched over the screen. */
export const BACKDROP_PIXELS = 48;
const BACKDROP_BLUR = 4;

/**
 * The soft, darkened blur of a picture itself that fills whatever of a full-screen viewer's page the picture leaves, so
 * no viewer letterboxes a photo or a video on black. A blur on the full-size picture barely shows once it is scaled to
 * the screen, so it is drawn from a tiny copy: `source` is loaded BACKDROP_PIXELS wide (useImage resizes it as it loads),
 * and `small` is one made that size already (a video's frame, see generateThumbnailsAsync). A 4000-pixel photo blurs as
 * softly as a small poster, and as cheaply. Nothing is drawn behind the dim until the copy is ready.
 */
export function BlurredBackdrop({ source, small }: { source?: ImageSource | string; small?: SharedRefType<"image"> | null }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {small ? <BackdropPicture picture={small} /> : source ? <LoadedSmall source={source} /> : null}
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </View>
  );
}

function LoadedSmall({ source }: { source: ImageSource | string }) {
  const key = typeof source === "string" ? source : (source.cacheKey ?? source.uri ?? "");
  const picture = useImage(source, { maxWidth: BACKDROP_PIXELS }, [key]);
  return picture ? <BackdropPicture picture={picture} /> : null;
}

function BackdropPicture({ picture }: { picture: SharedRefType<"image"> }) {
  return <Image source={picture} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={BACKDROP_BLUR} transition={0} />;
}

const styles = StyleSheet.create({
  // Dimmed, so it reads as background and the white words and controls over it stay readable.
  dim: { backgroundColor: "rgba(0,0,0,0.45)" },
});
