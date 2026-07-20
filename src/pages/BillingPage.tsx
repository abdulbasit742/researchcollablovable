import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileText, AlertTriangle, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import {
  getBillingState,
  downgradeToFree,
  pause30Days,
  cancelPlan,
  type BillingState,
  type BillingInvoice,
} from "@/lib/revenue/billingService";
import { paymentHub } from "@/services/payments";

const CREDIT_PACKS = [
  { c: 500, p: 499 }, { c: 2000, p: 1799 }, { c: 5000, p: 3999 }, { c: 12000, p: 8999 },
];

export default function BillingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState<BillingInvoice | null>(null);
  const dryRun = paymentHub.dryRun();

  const load = async () => {
    setLoading(true);
    try {
      setState(await getBillingState());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<void>, msg: string) => {
    try { await fn(); toast.success(msg); setCancelOpen(false); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (loading || !state) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading billing…
      </div>
    );
  }

  const { plan, planActive, nextBilling, creditBalance, invoices } = state;

  return (
    <>
      <Helmet><title>Billing — ResearchCollab</title></Helmet>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Billing & Subscription</h1>
            <p className="text-sm text-muted-foreground">Manage your plan, credits, and invoices</p>
          </div>
          {dryRun && <Badge variant="secondary">Sandbox</Badge>}
        </div>

        <Tabs defaultValue="plan">
          <TabsList>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="credits">AI Credits</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="plan">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.tagline}</CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">PKR {plan.priceMonthly.toLocaleString()}/mo</div>
                    <div className="text-xs text-muted-foreground">
                      {planActive && nextBilling ? `Next billing: ${nextBilling.slice(0, 10)}` : "No active paid plan"}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Badge variant={planActive ? "default" : "secondary"}>{planActive ? "Active" : "Free"}</Badge>
                <div className="flex gap-2">
                  <Button onClick={() => navigate("/checkout?plan=researcher_pro")}>Upgrade</Button>
                  <Button variant="outline" onClick={() => navigate("/checkout?plan=student_pro")}>Change plan</Button>
                  {planActive && <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel plan</Button>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credits">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Credit packs</CardTitle>
                <CardDescription>Current balance: {creditBalance.toLocaleString()} credits</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {CREDIT_PACKS.map((pk) => (
                  <div key={pk.c} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="font-medium">{pk.c.toLocaleString()} credits</div>
                      <div className="text-xs text-muted-foreground">PKR {(pk.p / pk.c).toFixed(2)} / credit</div>
                    </div>
                    <Button size="sm" onClick={() => navigate(`/checkout?credits=${pk.c}`)}>PKR {pk.p.toLocaleString()}</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card>
              <CardHeader><CardTitle className="text-base">Invoice history</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {invoices.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No invoices yet.</p>
                )}
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{inv.id}</div>
                        <div className="text-xs text-muted-foreground">{inv.date} · {inv.item}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">PKR {inv.amount.toLocaleString()}</span>
                      <Badge variant="secondary">{inv.status}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setInvoiceOpen(inv)}>View</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Cancel dialog with churn prevention */}
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Before you cancel…</DialogTitle>
              <DialogDescription>Help us understand — and consider these alternatives.</DialogDescription>
            </DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What made you consider leaving?" />
            <div className="grid gap-2">
              <Button variant="outline" onClick={() => act(downgradeToFree, "Switched to Free — your data is kept")}>Downgrade to Free</Button>
              <Button variant="outline" onClick={() => act(pause30Days, "Plan paused for 30 days")}>Pause 30 days</Button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep my plan</Button>
              <Button variant="destructive" onClick={() => act(() => cancelPlan(reason), "Cancellation recorded")}>Confirm cancellation</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Invoice detail */}
        <Dialog open={!!invoiceOpen} onOpenChange={(o) => !o && setInvoiceOpen(null)}>
          <DialogContent>
            {invoiceOpen && (
              <>
                <DialogHeader>
                  <DialogTitle>{invoiceOpen.id}</DialogTitle>
                  <DialogDescription>{invoiceOpen.date}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Description</span><span>{invoiceOpen.item}</span></div>
                  <div className="flex justify-between"><span>Subtotal</span><span>{invoiceOpen.currency} {invoiceOpen.amount.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Tax</span><span>{invoiceOpen.currency} 0</span></div>
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{invoiceOpen.currency} {invoiceOpen.amount.toLocaleString()}</span></div>
                  <Badge variant="secondary">{invoiceOpen.status}</Badge>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => toast("PDF export coming soon")}>Download PDF</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
