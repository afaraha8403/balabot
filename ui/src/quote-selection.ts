export const REPLY_QUOTE_MAX_LENGTH = 2_000;

export function truncateReplyQuote(value: string): string {
  const truncated = value.slice(0, REPLY_QUOTE_MAX_LENGTH);
  const last = truncated.charCodeAt(truncated.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

/**
 * Resolves a text selection to the message it quotes. A quote stays scoped to
 * one Markdown text region; selections that cross regions or include message
 * chrome and structured cards get no affordance. The excerpt is capped at
 * capture so an oversized selection never fails the send.
 */
export function quoteDraftForSelection(
  selection: {
    startContent: HTMLElement | null;
    endContent: HTMLElement | null;
    text: string;
  },
): { messageId: string; text: string } | null {
  const { startContent, endContent } = selection;
  if (!startContent || startContent !== endContent) return null;
  const messageId = startContent.dataset.quoteMessageId;
  const text = truncateReplyQuote(selection.text.trim());
  if (!messageId || !text) return null;
  return { messageId, text };
}
