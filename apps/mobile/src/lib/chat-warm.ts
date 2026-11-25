import { listMessages } from "@apartment-book/shared";
import { warm } from "./query-cache";
import { supabase } from "./supabase";

/**
 * Where a chat is kept for the session (lib/query-cache), per reader: its summary, which the inbox hands over so the chat
 * opens on it at once, and its newest messages, shown at once the next time it is opened while the server is asked
 * again behind them.
 */
export const conversationKey = (userId: string, conversationId: string) => `conversation:${userId}:${conversationId}`;
export const messagesKey = (userId: string, conversationId: string) => `messages:${userId}:${conversationId}`;

/** A chat's newest messages start loading as a finger touches its row, so the chat finds them ready or on their way. */
export function warmChat(userId: string, conversationId: string): void {
  if (!userId) return;
  warm(messagesKey(userId, conversationId), () => listMessages(supabase, conversationId));
}
