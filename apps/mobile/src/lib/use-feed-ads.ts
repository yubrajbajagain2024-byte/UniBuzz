import { useEffect, useRef, useState } from "react";
import type { ListViewToken } from "react-native";
import { ADS_EVERY, ADS_FIRST_AFTER, adSlotCount, adsToCount, emptyFeedAds, listFeedAds, nextAdsRequest, receiveAds, recordBusinessEvent, type AdPlacement, type AdSpacing, type FeedAd, type FeedAdsState } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/** Where the app's feeds put their ads (see adSlotsAfter): `ended` once the feed has no more pages. */
export const feedAdSpacing = (ended: boolean): AdSpacing => ({ first: ADS_FIRST_AFTER, ended });

const NO_ADS: FeedAd[] = [];

/**
 * The ads for a feed of `count` organic rows: the first after ADS_FIRST_AFTER rows (or at the end of a shorter feed
 * that has `ended`), then at most one per ADS_EVERY, only as many as there are slots, continuing the campus's daily
 * rotation (the database picks them by campus alone), and none signed out. `round` goes up each time the feed loads its
 * first page again (a pull-to-refresh, a new filter): the ads are then asked for again from the first, so a paused or
 * ended ad leaves and an approved or resumed one comes in (nextAdsRequest); the old ones stay until the new arrive, and
 * an answer from a round already over is dropped. A feed that runs out of eligible ads stops asking until the next round.
 */
export function useFeedAds(placement: AdPlacement, count: number, enabled: boolean, ended: boolean, round = 0): FeedAd[] {
  const [state, setState] = useState<FeedAdsState>(emptyFeedAds);
  // The round a request is out for (one at a time per round), and the feed's current round, read when an answer lands.
  const inflight = useRef<number | null>(null);
  const current = useRef(round);
  current.current = round;
  useEffect(() => {
    if (!enabled || inflight.current === round) return;
    const request = nextAdsRequest(state, round, adSlotCount(count, ADS_EVERY, feedAdSpacing(ended)));
    if (!request) return;
    inflight.current = round;
    // Cleared before the state changes, so the render it causes may ask for the slots the feed gained meanwhile.
    const settle = () => {
      if (inflight.current === request.round) inflight.current = null;
    };
    (request.limit > 0 ? listFeedAds(supabase, placement, request.limit, request.offset) : Promise.resolve(NO_ADS))
      .then((ads) => {
        settle();
        if (current.current === request.round) setState((prev) => receiveAds(prev, request, ads));
      })
      .catch(settle);
  }, [placement, count, enabled, ended, round, state]);
  return enabled ? state.ads : NO_ADS;
}

/** A list row that is an ad, next to the feed's own rows. */
export type AdRow = { id: string; ad: FeedAd };
export const isAdRow = (row: unknown): row is AdRow => typeof row === "object" && row !== null && "ad" in row;

/**
 * Counts an impression for each ad row the list reports on screen (at least the list's viewability threshold of it),
 * once per mount: the set outlives pull-to-refresh, so an ad that comes back after a refresh is not counted again
 * (adsToCount); the database keeps one per student, ad and hour.
 */
export function useAdImpressions(placement: AdPlacement) {
  const seen = useRef(new Set<string>());
  return (viewable: ListViewToken[]) => {
    const onScreen = viewable.filter((v) => v.isViewable && isAdRow(v.item)).map((v) => (v.item as AdRow).ad.id);
    for (const adId of adsToCount(seen.current, onScreen)) void recordBusinessEvent(supabase, "impression", { adId, placement });
  };
}
