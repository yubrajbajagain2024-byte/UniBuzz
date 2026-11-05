import { useEffect, useRef, useState } from "react";
import type { ListViewToken } from "react-native";
import { ADS_EVERY, ADS_FIRST_AFTER, adSlotCount, listFeedAds, recordBusinessEvent, type AdPlacement, type AdSpacing, type FeedAd } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/** Where the app's feeds put their ads (see adSlotsAfter): `ended` once the feed has no more pages. */
export const feedAdSpacing = (ended: boolean): AdSpacing => ({ first: ADS_FIRST_AFTER, ended });

/**
 * The ads for a feed of `count` organic rows: the first after ADS_FIRST_AFTER rows (or at the end of a shorter feed
 * that has `ended`), then at most one per ADS_EVERY, only as many as there are slots, continuing the campus's daily
 * rotation (the database picks them by campus alone), and none signed out. A feed that runs out of eligible ads stops
 * asking.
 */
export function useFeedAds(placement: AdPlacement, count: number, enabled: boolean, ended: boolean): FeedAd[] {
  const [ads, setAds] = useState<FeedAd[]>([]);
  const done = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled || done.current || busy.current) return;
    const need = adSlotCount(count, ADS_EVERY, feedAdSpacing(ended)) - ads.length;
    if (need <= 0) return;
    busy.current = true;
    listFeedAds(supabase, placement, need, ads.length)
      .then((more) => {
        if (more.length < need) done.current = true;
        setAds((prev) => [...prev, ...more.filter((a) => !prev.some((p) => p.id === a.id))]);
      })
      .finally(() => {
        busy.current = false;
      });
  }, [placement, count, ads.length, enabled, ended]);
  return ads;
}

/** A list row that is an ad, next to the feed's own rows. */
export type AdRow = { id: string; ad: FeedAd };
export const isAdRow = (row: unknown): row is AdRow => typeof row === "object" && row !== null && "ad" in row;

/**
 * Counts an impression for each ad row the list reports on screen (at least 60% of it, the lists' viewability), once per
 * mount; the database keeps one per student per hour.
 */
export function useAdImpressions(placement: AdPlacement) {
  const seen = useRef(new Set<string>());
  return (viewable: ListViewToken[]) => {
    for (const v of viewable) {
      if (!v.isViewable || !isAdRow(v.item) || seen.current.has(v.item.ad.id)) continue;
      seen.current.add(v.item.ad.id);
      void recordBusinessEvent(supabase, "impression", { adId: v.item.ad.id, placement });
    }
  };
}
