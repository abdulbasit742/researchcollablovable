import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getPlatformEarnings, type EarningsByStream } from "@/lib/revenue/platformEarnings";
import { getCommissionPercent, setCommissionPercent } from "@/lib/admin/commissionSettings";

export interface Transaction {
  id: string;
  user_id: string;
  tool_id: string;
  amount: number;
  status: string;
  currency: string;
  created_at: string;
  user_name?: string;
  tool_name?: string;
}

export interface Dispute {
  id: string;
  milestone_id: string;
  initiated_by: string;
  resolved_by: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  milestone_title?: string;
  milestone_amount?: number;
  initiator_name?: string;
}

export function useAdminFinance() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [walletStats, setWalletStats] = useState({ totalEscrow: 0, totalAvailable: 0, totalPending: 0 });
  const [platform, setPlatform] = useState<{
    total: number; mrr: number; earnings30d: number; byStream: EarningsByStream;
  }>({ total: 0, mrr: 0, earnings30d: 0, byStream: { subscriptions: 0, ai_credits: 0, marketplace_commission: 0, other: 0 } });
  const [commissionPercent, setCommissionPercentState] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchFinanceData(); }, []);

  const fetchFinanceData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchTransactions(),
        fetchDisputes(),
        fetchWalletStats(),
        fetchPlatformEarnings(),
        fetchCommission(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlatformEarnings = async () => {
    try {
      const e = await getPlatformEarnings();
      setPlatform({ total: e.total, mrr: e.mrr, earnings30d: e.earnings30d, byStream: e.byStream });
    } catch (err) {
      console.error("Error fetching platform earnings:", err);
    }
  };

  const fetchCommission = async () => {
    try { setCommissionPercentState(await getCommissionPercent()); }
    catch (err) { console.error("Error fetching commission rate:", err); }
  };

  const saveCommissionPercent = async (percent: number) => {
    try {
      await setCommissionPercent(percent);
      setCommissionPercentState(percent);
      toast({ title: "Commission Updated", description: `Commission rate set to ${percent}%` });
      return { success: true };
    } catch (err: any) {
      toast({ title: "Invalid Commission", description: err.message, variant: "destructive" });
      return { success: false };
    }
  };

  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from("tool_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const userIds = [...new Set(data?.map((t) => t.user_id) || [])];
      const toolIds = [...new Set(data?.map((t) => t.tool_id) || [])];
      const [profilesRes, toolsRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", userIds),
        supabase.from("tools").select("id, name").in("id", toolIds),
      ]);
      const profileMap = new Map(profilesRes.data?.map((p) => [p.id, p.full_name]) || []);
      const toolMap = new Map(toolsRes.data?.map((t) => [t.id, t.name]) || []);

      setTransactions((data || []).map((txn) => ({
        ...txn,
        user_name: profileMap.get(txn.user_id) || "Unknown",
        tool_name: toolMap.get(txn.tool_id) || "Unknown Tool",
      })));
    } catch (err) {
      console.error("Error fetching transactions:", err);
    }
  };

  const fetchDisputes = async () => {
    try {
      const { data, error } = await supabase
        .from("disputes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const disputesWithDetails = await Promise.all(
        (data || []).map(async (dispute) => {
          const [milestoneRes, profileRes] = await Promise.all([
            supabase.from("milestones").select("title, amount").eq("id", dispute.milestone_id).maybeSingle(),
            supabase.from("profiles").select("full_name").eq("id", dispute.initiated_by).maybeSingle(),
          ]);
          return {
            ...dispute,
            milestone_title: milestoneRes.data?.title || "Unknown Milestone",
            milestone_amount: milestoneRes.data?.amount || 0,
            initiator_name: profileRes.data?.full_name || "Unknown",
          };
        }),
      );
      setDisputes(disputesWithDetails);
    } catch (err) {
      console.error("Error fetching disputes:", err);
    }
  };

  const fetchWalletStats = async () => {
    try {
      const { data, error } = await supabase
        .from("wallets")
        .select("available_balance, escrow_balance, pending_balance");
      if (error) throw error;
      setWalletStats((data || []).reduce(
        (acc, w) => ({
          totalEscrow: acc.totalEscrow + Number(w.escrow_balance || 0),
          totalAvailable: acc.totalAvailable + Number(w.available_balance || 0),
          totalPending: acc.totalPending + Number(w.pending_balance || 0),
        }),
        { totalEscrow: 0, totalAvailable: 0, totalPending: 0 },
      ));
    } catch (err) {
      console.error("Error fetching wallet stats:", err);
    }
  };

  const getStats = () => {
    const completed = transactions.filter((t) => t.status === "completed" || t.status === "delivered");
    const toolRevenue = completed.reduce((sum, t) => sum + Number(t.amount), 0);
    const rate = commissionPercent / 100;
    const toolCommission = toolRevenue * rate;

    // Total platform revenue = marketplace tool commission + all other streams (#36).
    const totalRevenue = platform.total + toolRevenue;
    const totalCommission = platform.byStream.marketplace_commission + toolCommission;
    const totalPayout = toolRevenue - toolCommission;
    const openDisputes = disputes.filter((d) => d.status === "open" || d.status === "under_review").length;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthlyToolRevenue = completed
      .filter((t) => new Date(t.created_at) >= startOfMonth)
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const monthlyRevenue = monthlyToolRevenue + platform.earnings30d;

    return {
      totalRevenue,
      totalCommission,
      totalPayout,
      monthlyRevenue,
      openDisputes,
      mrr: platform.mrr,
      revenueByStream: {
        ...platform.byStream,
        marketplace_tool_orders: toolRevenue,
      },
      ...walletStats,
    };
  };

  const resolveDispute = async (disputeId: string, resolution: string, action: "release" | "refund") => {
    try {
      const { error } = await supabase
        .from("disputes")
        .update({ status: "resolved", resolution, resolved_at: new Date().toISOString() })
        .eq("id", disputeId);
      if (error) throw error;
      toast({
        title: "Dispute Resolved",
        description: `Funds have been ${action === "release" ? "released to seller" : "refunded to buyer"}`,
      });
      await fetchDisputes();
      return { success: true };
    } catch (err: any) {
      toast({ title: "Failed to resolve dispute", variant: "destructive" });
      return { success: false, error: err.message };
    }
  };

  return {
    transactions,
    disputes,
    loading,
    stats: getStats(),
    commissionPercent,
    saveCommissionPercent,
    refetch: fetchFinanceData,
    resolveDispute,
  };
}
