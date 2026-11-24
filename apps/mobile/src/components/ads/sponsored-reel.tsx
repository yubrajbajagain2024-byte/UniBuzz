import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { adCtaLabel, muxPlaybackUrl, muxPosterUrl, type FeedAd } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { safeBusinessImage } from "@/lib/safe-media";
import { VIDEO_AUDIO_MODE, VIDEO_MUTED } from "@/lib/video-sound";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { adPicture, useAdActions } from "./sponsored-card";

/** The ad's own video once it is ready to stream (a Reels ad has one, vertical: the database checks it at submission). */
function adVideo(ad: FeedAd) {
  const v = ad.media.find((m) => m.type === "video");
  return v && v.type === "video" && v.playback_id ? v : null;
}

/** The ad's video, looping with its sound on like every video (see VIDEO_MUTED), playing only while its page is the one on screen. */
function AdVideo({ playbackId, playing, style }: { playbackId: string; playing: boolean; style: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer({ uri: muxPlaybackUrl(playbackId) }, (p) => {
    p.loop = true;
    p.muted = VIDEO_MUTED;
    p.audioMixingMode = VIDEO_AUDIO_MODE;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  return <VideoView player={player} style={style} contentFit="contain" nativeControls={false} allowsVideoFrameAnalysis={false} />;
}

/**
 * Orbit (and Home → Reels): an ad as a page of its own, one swipe like any post. Its video (its picture when it has
 * none) is shown whole, never cropped, centred in the area above the bottom bar (`mediaBottom`, the bar's room, as
 * every picture on Orbit is: the owner's brief, 2026-11-22), black round it; "Sponsored" under the business's name, the
 * headline, the caption and its button above the bottom bar; the ••• menu hides it, reports it, blocks the business or
 * says why it is there. A player exists only near the page on screen (`near`), as for reels.
 */
export function SponsoredReel({ ad, width, height, topInset, bottomInset, mediaBottom = 0, playing, near }: { ad: FeedAd; width: number; height: number; topInset: number; bottomInset: number; mediaBottom?: number; playing: boolean; near: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  // From the top of the screen to the top of the bottom bar, never behind it.
  const box = { position: "absolute" as const, top: 0, left: 0, width, height: Math.max(0, height - mediaBottom) };
  const { gone, act, menu, openProfile } = useAdActions(ad, "reels");
  const video = adVideo(ad);
  const poster = video ? safeBusinessImage(video.poster_url ?? muxPosterUrl(video.playback_id!)) : adPicture(ad);

  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }} testID="sponsored-reel" accessibilityLabel={`Sponsored by ${ad.business_name}`}>
      {gone ? (
        <View style={[StyleSheet.absoluteFill, styles.centered]}>
          <Text style={styles.gone}>{gone}</Text>
        </View>
      ) : (
        <>
          {poster ? <Image source={{ uri: poster }} style={box} contentFit="contain" transition={0} /> : null}
          {video && near ? <AdVideo playbackId={video.playback_id!} playing={playing} style={box} /> : null}
          <View style={styles.shade} pointerEvents="none" />
          <View style={[styles.bottom, { bottom: bottomInset + 16 }]}>
            <View style={styles.header}>
              <Pressable onPress={openProfile} accessibilityRole="link" accessibilityLabel={`${ad.business_name}'s profile`}>
                <Avatar name={ad.business_name} url={safeBusinessImage(ad.business_logo_url)} size={36} />
              </Pressable>
              <Pressable onPress={openProfile} style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {ad.business_name}
                  </Text>
                  {ad.verified_partner ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={15} color="#ffffff" accessibilityLabel="Verified Partner" /> : null}
                </View>
                <Text style={styles.sponsored}>Sponsored</Text>
              </Pressable>
              <Pressable onPress={menu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ad options">
                <Icon name="ellipsis-horizontal" size={22} color="#ffffff" />
              </Pressable>
            </View>
            {ad.headline ? <Text style={styles.headline}>{ad.headline}</Text> : null}
            {ad.caption ? (
              <Text style={styles.caption} numberOfLines={2}>
                {ad.caption}
              </Text>
            ) : null}
            <Pressable onPress={() => void act()} accessibilityRole="button" accessibilityLabel={adCtaLabel(ad.cta)} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
              <Text style={styles.ctaText}>{adCtaLabel(ad.cta)}</Text>
              <Icon name="chevron-forward" size={18} color="#111111" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/** Drawn over video, so in the media colours whatever the theme (as the Reels page is). */
const useStyles = makeStyles((colors) => ({
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  gone: { color: colors.onMedia, fontSize: 14, textAlign: "center", lineHeight: 20 },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "45%", experimental_backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)" },
  bottom: { position: "absolute", left: 14, right: 14, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: "#ffffff", fontWeight: "700", fontSize: 15, flexShrink: 1 },
  sponsored: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  headline: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  caption: { color: "rgba(255,255,255,0.9)", fontSize: 14, lineHeight: 19 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 44, borderRadius: 12, paddingHorizontal: 16, backgroundColor: "rgba(255,255,255,0.95)" },
  ctaText: { color: "#111111", fontWeight: "700", fontSize: 14 },
}));
