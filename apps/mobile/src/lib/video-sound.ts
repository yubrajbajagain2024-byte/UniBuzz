import type { AudioMixingMode } from "expo-video";

/**
 * How every video meets other audio, the same on the feed's players and the viewer's (a handed-over player keeps the
 * session as it was). With its sound on, a video takes the audio over while it plays. (Native expo-video defaults to
 * "doNotMix" as well; "auto" is kept so a muted preview, such as a chat thumbnail's, leaves the person's music playing.)
 */
export const VIDEO_AUDIO_MODE: AudioMixingMode = "auto";

/**
 * Every video plays with its sound on (owner, 2026-11-16): the feeds' videos, the Reels tab, the full-screen viewer,
 * sponsored reels, chats, Stories and Snaps alike, and there is no mute or sound button anywhere (the phone's volume
 * buttons rule it). Only one video plays at a time (each feed plays only its visible video, only on the page and screen
 * on show; see PhotoCarousel, ReelsSection, the viewer's pager), so turning from one video to the next never overlaps
 * their sound. A video handed from the feed to the viewer (see video-handoff.ts) goes on with its sound, there and back.
 */
export const VIDEO_MUTED = false;
