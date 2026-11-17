import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BEAUTY_DEFAULT_INTENSITY, clampBeautyIntensity, isBeautyFilterId, type BeautyFilterId } from "@apartment-book/shared";

/** The camera's filter and how strong it is, kept on this device only (nothing about it is ever sent anywhere). */
const KEY = "camera.beauty.v1";

type Saved = { filter: BeautyFilterId | null; intensity: number };
const NONE: Saved = { filter: null, intensity: BEAUTY_DEFAULT_INTENSITY };

let cache: Saved | null = null;

async function read(): Promise<Saved> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const o = typeof parsed === "object" && parsed !== null ? (parsed as Partial<Saved>) : {};
    cache = { filter: isBeautyFilterId(o.filter) ? o.filter : null, intensity: clampBeautyIntensity(o.intensity) };
  } catch {
    cache = NONE;
  }
  return cache;
}

/**
 * The camera's beauty choice, remembered between visits as TikTok's is: the filter last picked (none by default: the
 * camera opens unfiltered until someone chooses) and its intensity.
 */
export function useBeautyChoice() {
  const [choice, setChoice] = useState<Saved>(cache ?? NONE);
  useEffect(() => {
    let alive = true;
    void read().then((saved) => alive && setChoice(saved));
    return () => {
      alive = false;
    };
  }, []);
  const save = useCallback((next: Saved) => {
    cache = next;
    setChoice(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);
  const setFilter = useCallback((filter: BeautyFilterId | null) => save({ filter, intensity: (cache ?? NONE).intensity }), [save]);
  const setIntensity = useCallback((intensity: number) => save({ filter: (cache ?? NONE).filter, intensity: clampBeautyIntensity(intensity) }), [save]);
  return { filter: choice.filter, intensity: choice.intensity, setFilter, setIntensity };
}
