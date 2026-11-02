import { LogBox, NativeModules, Platform } from "react-native";

/**
 * Calls are paused for the launch, to hold down what they cost to run (the owner's decision, 2026-11-02; at first it
 * was because no iPhone build could carry them without an Apple Developer Program membership). Nothing of them shows:
 * no Audio call or Video call in a chat's bar, no Join banner, no ring and no incoming-call screen, and the call screen
 * cannot be opened (a link to one goes to Messages). A call made before the pause keeps its row in the chat, as history
 * that a tap no longer calls back, the way the website shows it. Nothing is written to the database and no ring is
 * listened for. Everything behind them stays as it is (the screens and components, the database functions and the call
 * records, the livekit-token function, LiveKit, the native modules and their config), and a build bundled with
 * EXPO_PUBLIC_CALLS_ENABLED=1 turns calls back on.
 */
export const CALLS_PAUSED: boolean = process.env.EXPO_PUBLIC_CALLS_ENABLED !== "1";

/**
 * Whether this build can carry a call's audio and video: the LiveKit module is compiled into the app's own builds
 * (the config plugins in app.json), never into Expo Go. Without it, calls can still be started, rung and answered (the
 * database and the chats do that), but no sound or picture flows: the call screen says so, and offers to hang up.
 * The LiveKit JavaScript is loaded only where the module is there, so a build without it never touches it.
 */
export const CALLS_AVAILABLE: boolean = (() => {
  try {
    // A classic React Native module (not an Expo one): present only in builds made with the LiveKit plugin.
    return Platform.OS !== "web" && Boolean(NativeModules.LivekitReactNativeModule);
  } catch {
    return false;
  }
})();

type LiveKit = typeof import("@livekit/react-native");

let livekit: LiveKit | null = null;

/** The LiveKit SDK, with its globals registered once; null where the build has no media module. */
export function loadLiveKit(): LiveKit | null {
  if (!CALLS_AVAILABLE) return null;
  if (livekit) return livekit;
  try {
    const sdk = require("@livekit/react-native") as LiveKit;
    sdk.registerGlobals();
    // livekit-client logs an error when the server closes the socket on our own hang-up ("WS closed unexpectedly with
    // code 1001"); it is the normal end of a call, not worth a development toast.
    LogBox.ignoreLogs([/error reading from signal stream/, /could not determine track dimensions/]);
    livekit = sdk;
    return sdk;
  } catch {
    return null;
  }
}

/** What the call screen says where the build cannot carry the call. */
export const CALLS_UNAVAILABLE_TEXT = Platform.OS === "web" ? "Calls are made from the UniBuzz app." : "This copy of UniBuzz can't carry calls. Install the app build to talk.";
