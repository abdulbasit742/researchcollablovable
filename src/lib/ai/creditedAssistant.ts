/**
 * Credited Assistant — enforces AI credits (#13) on every assistant action.
 *
 * Problem this fixes: aiCredits.ts shipped a meterUsage() helper, but the
 * actual AI entry points (personalAssistant.streamChat / generateRecommendations)
 * never called it, so AI was effectively free and unlimited and the credit
 * revenue model was bypassed.
 *
 * This is a thin wrapper: it checks the balance BEFORE a call and debits AFTER
 * success only (a failed generation never costs the user). The underlying
 * personalAssistant API is left untouched.
 */
import {
  streamChat,
  generateRecommendations,
  type PAIMessage,
  type PAIRecommendation,
} from "@/lib/ai/personalAssistant";
import {
  hasCreditsFor,
  spend,
  ACTION_COST,
  InsufficientCreditsError,
  type CreditAction,
} from "@/lib/ai/aiCredits";

export { InsufficientCreditsError } from "@/lib/ai/aiCredits";

export interface CreditedChatArgs {
  messages: PAIMessage[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError?: (err: Error) => void;
  /** Called when the user can't afford the action; UI should prompt a top-up. */
  onInsufficient?: (needed: number, available: number) => void;
}

/**
 * Credited streaming chat. Checks credits up front; only debits once a real
 * (non-empty) response has streamed back, so failed/empty calls are free.
 */
export async function creditedStreamChat(args: CreditedChatArgs): Promise<void> {
  const action: CreditAction = "chat_message";

  if (!(await hasCreditsFor(action))) {
    args.onInsufficient?.(ACTION_COST[action], 0);
    args.onError?.(new InsufficientCreditsError(ACTION_COST[action], 0));
    return;
  }

  let received = false;
  await streamChat({
    messages: args.messages,
    onDelta: (t) => { if (t) received = true; args.onDelta(t); },
    onDone: async () => {
      try {
        if (received) await spend(action, "assistant:chat");
      } finally {
        args.onDone();
      }
    },
    onError: args.onError,
  });
}

/**
 * Credited recommendations. Priced as a literature_review action (heavier than
 * a chat turn). Debits only after a successful response.
 */
export async function creditedRecommendations(
  userProfile: Record<string, unknown>,
): Promise<PAIRecommendation[]> {
  const action: CreditAction = "literature_review";
  if (!(await hasCreditsFor(action))) {
    const { balance } = await import("@/lib/ai/aiCredits").then((m) => m.getBalance());
    throw new InsufficientCreditsError(ACTION_COST[action], balance);
  }
  const recs = await generateRecommendations(userProfile);
  await spend(action, "assistant:recommendations");
  return recs;
}

/** Cost preview for the UI (e.g. "This will use N credits"). */
export function actionCost(action: CreditAction): number {
  return ACTION_COST[action];
}
