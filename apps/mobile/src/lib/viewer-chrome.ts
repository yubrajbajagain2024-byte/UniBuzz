import { createContext } from "react";
import type { DerivedValue, SharedValue } from "react-native-reanimated";

/**
 * How much of the viewer's chrome shows (0 to 1): the words, the rail, the dots and the controls over each page. The
 * viewer fades them in once a page has zoomed open to the full screen, out as it zooms closed, and away as a page is
 * pulled back with a swipe, so they never squeeze through the opening. Elsewhere (the Reels tab) there is none, and they
 * simply show.
 */
export const ViewerChromeContext = createContext<DerivedValue<number> | null>(null);

/**
 * A feed that can show its page on screen as a card under something it opens above it: Orbit, while its stories row is
 * open (components/home/orbit-section.tsx), TikTok's way. `open` is how far that is (0 to 1, on the UI thread): the
 * page's words, rail and shades fade out with it, and its picture rises from its place on the whole screen to its place
 * in the card, `height` tall (what of the card shows above the bottom bar): centred there, or at the card's top when it
 * is taller, as TikTok's card shows a video's top. `chromeOff`: the row is open, so the words and the rail, put away,
 * take no touches and leave VoiceOver too. Nothing else about the page changes, and it re-renders for none of the motion.
 */
/**
 * Told whether the post on screen in a feed is clear (a pinch on it, TikTok's clear mode: see ReelItem), so what the
 * feed and the screen draw over it (Orbit's stories, Home's top bar) clears with it.
 */
export const FeedClearContext = createContext<((clear: boolean) => void) | null>(null);

export const FeedCardContext = createContext<{ open: Readonly<SharedValue<number>>; height: number; chromeOff: boolean } | null>(null);

/**
 * 1 while the viewer's page zooms open out of the picture that was tapped, or closed into it (0 otherwise), on the UI
 * thread. A video then shows whole through the opening, past its page's sides, exactly as the feed showed it (see
 * wholeVideo), so even a carousel's slide stops trimming its video; between zooms each slide trims its own, so nothing
 * spills onto the next one as it slides.
 */
export const ViewerZoomContext = createContext<Readonly<SharedValue<number>> | null>(null);

/**
 * True once the viewer has started to close. The video it hands back to the feed is set playing as the close starts and
 * stays so (a pause still pending from a tap no longer lands), so it is moving as it shrinks back.
 */
export const ViewerClosingContext = createContext(false);

/**
 * The band of the screen a feed's pictures show in now, between its floating bars (window points, top and bottom). The
 * viewer's zoom opens out of (and lands on) only the part of a tapped picture inside it: the bars stay drawn over the
 * rest, as they were, and the zoom grows over them. Where nothing floats over a list there is none.
 */
export type OpeningBand = { top: number; bottom: number };
export const OpeningBandContext = createContext<(() => OpeningBand) | null>(null);

/**
 * Where each page's videos have got to, for the viewer to hand back to the feed as it closes (so the row's own player
 * goes on from there). A page's video registers how to read its position (`read`), and takes it back (null) as it goes.
 */
export type ViewerClocks = { set: (key: string, slide: number, read: (() => number) | null) => void };
export const ViewerClockContext = createContext<ViewerClocks | null>(null);

/**
 * Holds the viewer's pager still (true) while a photo on the page showing is zoomed in: one finger then pans the photo
 * instead of moving to the next post. The page that locked it unlocks it, as it zooms back out or goes.
 */
export const ViewerPagerLockContext = createContext<((locked: boolean) => void) | null>(null);
