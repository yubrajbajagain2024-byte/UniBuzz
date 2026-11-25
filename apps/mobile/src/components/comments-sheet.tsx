import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { PostTargetType } from "@apartment-book/shared";
import { useOpenProfile } from "@/lib/open-profile";
import { makeStyles } from "@/lib/theme-provider";
import { CommentComposer, CommentList, commentCountLabel, CommentProfileOpener, CommentsOff, CommentSortButton, useCommentThread } from "./comments";
import { Sheet, SheetFooter, SheetHeader, SheetScrollView } from "./sheet";

/**
 * `focusComposer` opens the sheet straight into typing, once the sheet has slid up. `commentsOff`: the author turned
 * comments off (migration 44), so the sheet says so instead of offering a thread to write in.
 */
export type CommentsTarget = { targetType: PostTargetType; targetId: string; ownerId: string; comments: number; focusComposer?: boolean; commentsOff?: boolean };

/**
 * Bottom sheet with the comment thread of one post or reel, TikTok style: the count up top (the sort button beside it),
 * the thread, and the composer pinned under it. Pass `target = null` to keep it closed. Built on the app's one Sheet,
 * full width (the owner's brief, 2026-11-22: edge to edge, no gaps at its sides, down to the bottom): it rises on the
 * system's spring over a fading backdrop; the header, or the list pulled down from its top, pulls it down; and the
 * composer rides just above the keyboard while the sheet's top stays where it was. A commenter's photo or name closes the
 * sheet and then opens their profile (straight away on Android, once the sheet has gone on iOS, which shows nothing new
 * while a modal is on screen), so the thread is never left open over it.
 */
export function CommentsSheet({ target, onClose, onCountChange }: { target: CommentsTarget | null; onClose: () => void; onCountChange: (delta: number) => void }) {
  // Keep showing the last thread while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<CommentsTarget | null>(target);
  useEffect(() => {
    if (target) setShown(target);
  }, [target]);

  const openProfile = useOpenProfile();
  /** The profile to open once the sheet is gone, and the timer that opens it should the dismissal never be reported. */
  const afterDismiss = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (fallback.current && clearTimeout(fallback.current)), []);
  const runAfterDismiss = useCallback(() => {
    const fn = afterDismiss.current;
    afterDismiss.current = null;
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    fn?.();
  }, []);
  const openFromComment = useCallback(
    (id: string) => {
      onClose();
      const go = () => openProfile(id);
      if (Platform.OS !== "ios") return go();
      afterDismiss.current = go;
      // The sheet slides away first (about a quarter second), then the modal goes: allow for both.
      if (fallback.current) clearTimeout(fallback.current);
      fallback.current = setTimeout(runAfterDismiss, 900);
    },
    [onClose, openProfile, runAfterDismiss],
  );

  return (
    <Sheet visible={target !== null} onClose={onClose} onDismiss={runAfterDismiss} closeLabel="Close comments" height="72%" keyboard edge="full">
      {shown?.commentsOff ? (
        <>
          <SheetHeader title="Comments" />
          <CommentsOff style={{ paddingVertical: 32 }} />
        </>
      ) : shown ? (
        <CommentProfileOpener.Provider value={openFromComment}>
          <SheetBody key={`${shown.targetType}:${shown.targetId}`} target={shown} onCountChange={onCountChange} />
        </CommentProfileOpener.Provider>
      ) : null}
    </Sheet>
  );
}

/** The thread of one target: header with the count and sort button, the scrolling list, and the composer pinned at the bottom. */
function SheetBody({ target, onCountChange }: { target: CommentsTarget; onCountChange: (delta: number) => void }) {
  const styles = useStyles();
  const thread = useCommentThread({ targetType: target.targetType, targetId: target.targetId, ownerId: target.ownerId, onCountChange });
  // The post's number until the thread has loaded, then what is really there (replies included).
  const count = thread.count ?? target.comments;
  // Asked to type straight away: the keyboard comes up once the sheet has risen into place (the body mounts with the sheet).
  const { inputRef } = thread;
  useEffect(() => {
    if (!target.focusComposer) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [target.focusComposer, inputRef]);
  return (
    <>
      <SheetHeader title={commentCountLabel(count)} leading={<CommentSortButton onSort={thread.setSort} />} />
      <SheetScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        <CommentList thread={thread} emptyText="Be the first to comment." />
      </SheetScrollView>
      <SheetFooter style={styles.footer}>
        <CommentComposer thread={thread} />
      </SheetFooter>
    </>
  );
}

const useStyles = makeStyles(() => ({
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  footer: { paddingTop: 10 },
}));
