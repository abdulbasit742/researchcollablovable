import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Plus, AlertTriangle, Users, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getBalance, getLedger } from "@/lib/ai/aiCredits";

interface LedgerEntry { date: string; action: string; credits: number; }

interface AICreditsPanelProps {
  /** When set, the panel renders these instead of loading live data (preview/storybook). */
  monthlyAllowance?: number;
  used?: number;
  bonus?: number;
  departmentPool?: { total: number; used: number } | null;
  history?: LedgerEntry[];
  compact?: boolean;
}

function reasonLabel(reason: string, note?: string | null): string {
  if (note?.startsWith("assistant:chat")) return "AI Chat";
  if (note?.startsWith("assistant:recommendations")) return "Recommendations";
  if (note?.startsWith("metered:")) return note.slice(8).replace(/_/g, " ");
  switch (reason) {
    case "purchase": return "Credit purchase";
    case "proposal_draft": return "Proposal Draft";
    case "paper_summarize": return "Paper Summary";
    case "literature_review": return "Literature Review";
    case "plagiarism_check": return "Plagiarism Check";
    case "dataset_insight": return "Dataset Insight";
    default: return reason.replace(/_/g, " ");
  }
}

export function AICreditsPanel(props: AICreditsPanelProps) {
  const { departmentPool = null, compact = false } = props;
  const previewMode = props.used !== undefined || props.history !== undefined;

  const [loading, setLoading] = useState(!previewMode);
  const [balance, setBalance] = useState(0);
  const [purchased, setPurchased] = useState(props.monthlyAllowance ?? 0);
  const [spent, setSpent] = useState(props.used ?? 0);
  const [history, setHistory] = useState<LedgerEntry[]>(props.history ?? []);

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    (async () => {
      try {
        const [bal, ledger] = await Promise.all([getBalance(), getLedger(8)]);
        if (!active) return;
        setBalance(bal.balance);
        setPurchased(bal.lifetimePurchased);
        setSpent(bal.lifetimeSpent);
        setHistory(
          (ledger as any[]).map((e) => ({
            date: (e.created_at ?? "").slice(0, 10),
            action: reasonLabel(e.reason, e.note),
            credits: Number(e.amount),
          })),
        );
      } catch {
        // Not signed in / tables empty -> show zeros, not a crash.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [previewMode]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading credits…
        </CardContent>
      </Card>
    );
  }

  // "total" reference for the usage bar: balance + spent gives a meaningful
  // "of what you've had" denominator; fall back to purchased when available.
  const total = Math.max(purchased, balance + spent, 1);
  const remaining = balance;
  const pct = Math.min(100, Math.round(((total - remaining) / total) * 100));
  const low = remaining < total * 0.15;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" /> AI Credits
          </CardTitle>
          <Badge variant="secondary">{remaining.toLocaleString()} left</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-end justify-between">
            <span className="text-3xl font-bold">{remaining.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">{spent.toLocaleString()} spent · {purchased.toLocaleString()} purchased</span>
          </div>
          <Progress value={pct} className="mt-2" />
        </div>

        {low && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
            <div>
              <div className="font-medium">Running low</div>
              <div className="text-muted-foreground">Buy a top-up pack to keep generating.</div>
            </div>
          </div>
        )}

        {departmentPool && (
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> Department pool</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {(departmentPool.total - departmentPool.used).toLocaleString()} shared remaining
              <span className="ml-1">({departmentPool.used.toLocaleString()} / {departmentPool.total.toLocaleString()})</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "500", credits: 500, price: "PKR 499" },
            { label: "2,000", credits: 2000, price: "PKR 1,799" },
            { label: "5,000", credits: 5000, price: "PKR 3,999" },
          ].map((p) => (
            <Button key={p.label} asChild variant="outline" className="h-auto flex-col py-2">
              <Link to={`/checkout?credits=${p.credits}`}>
                <span className="font-semibold">+{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.price}</span>
              </Link>
            </Button>
          ))}
        </div>

        {!compact && (
          <div>
            <div className="mb-2 text-sm font-medium">Recent activity</div>
            <div className="space-y-1">
              {history.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
              )}
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div>
                    <span>{h.action}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{h.date}</span>
                  </div>
                  <span className={h.credits > 0 ? "text-emerald-600" : "text-muted-foreground"}>
                    {h.credits > 0 ? "+" : ""}{h.credits}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button asChild className="w-full">
          <Link to="/checkout?credits=2000"><Plus className="mr-2 h-4 w-4" /> Buy more credits</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
