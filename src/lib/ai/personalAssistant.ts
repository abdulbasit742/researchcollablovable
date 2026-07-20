/**
 * Personal AI Assistant — Service layer.
 * Additive system. Does NOT mutate core financial or trust engines.
 *
 * As of #83, chat + recommendations route through the CREDITED ai-universal
 * client (#73) instead of the standalone pai-assistant edge function, so they
 * inherit server-side credit enforcement (#51), the 402 top-up UX, and
 * local-Ollama-first routing (#49). The public API below is unchanged, so
 * existing callers and the #44 creditedAssistant wrapper keep working.
 */
import { supabase } from "@/integrations/supabase/client";
import { callAIUniversal, streamAIUniversal } from "@/lib/ai/aiUniversalClient";

// ─── Types ───
export interface PAIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PAIConversation {
  id: string;
  title: string;
  context_type: string;
  created_at: string;
  updated_at: string;
}

export interface PAIRecommendation {
  type: string;
  title: string;
  summary: string;
  relevance_score: number;
  action_suggestion?: string;
}

// ─── Conversations ───

export async function getConversations() {
  const { data, error } = await (supabase as any)
    .from("pai_conversations")
    .select("*")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function createConversation(title?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await (supabase as any)
    .from("pai_conversations")
    .insert({ user_id: user.id, title: title || "New Conversation" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function archiveConversation(id: string) {
  const { error } = await (supabase as any)
    .from("pai_conversations")
    .update({ is_archived: true })
    .eq("id", id);
  if (error) throw error;
}

// ─── Messages ───

export async function getMessages(conversationId: string) {
  const { data, error } = await (supabase as any)
    .from("pai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function saveMessage(conversationId: string, role: string, content: string) {
  const { data, error } = await (supabase as any)
    .from("pai_messages")
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single();
  if (error) throw error;

  await (supabase as any)
    .from("pai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data;
}

// ─── Streaming Chat (credited via ai-universal) ───

export async function streamChat({
  messages,
  onDelta,
  onDone,
  onError,
}: {
  messages: PAIMessage[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError?: (err: Error) => void;
}) {
  // Routes through the credited client: server debits 1 credit (general.chat),
  // returns 402 -> top-up toast when broke, and prefers local Ollama.
  await streamAIUniversal({
    domain: "general",
    action: "chat",
    messages,
    onDelta,
    onDone,
    onError,
  });
}

// ─── Recommendations (credited) ───

export async function generateRecommendations(userProfile: Record<string, unknown>) {
  const res = await callAIUniversal<{ recommendations?: PAIRecommendation[] }>({
    domain: "career",
    action: "coaching-advice",
    context: userProfile,
  });
  return (res?.recommendations ?? []) as PAIRecommendation[];
}

// ─── Recommendations DB ───

export async function getSavedRecommendations() {
  const { data, error } = await (supabase as any)
    .from("pai_recommendations")
    .select("*")
    .eq("dismissed", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function dismissRecommendation(id: string) {
  const { error } = await (supabase as any)
    .from("pai_recommendations")
    .update({ dismissed: true })
    .eq("id", id);
  if (error) throw error;
}

// ─── Insights ───

export async function getInsights() {
  const { data, error } = await (supabase as any)
    .from("pai_insights")
    .select("*")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function markInsightRead(id: string) {
  const { error } = await (supabase as any)
    .from("pai_insights")
    .update({ is_read: true })
    .eq("id", id);
  if (error) throw error;
}
