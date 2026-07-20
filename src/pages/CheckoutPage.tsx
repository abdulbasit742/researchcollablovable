import { useSearchParams, Link } from "react-router-dom";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, ShieldCheck, Tag, CreditCard, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPlan, type PlanId } from "@/lib/revenue/plans";
import {
  checkoutPlan,
  checkoutCredits,
  resolvePromo,
  CREDIT_PACKS,
} from "@/lib/revenue/checkoutService";
import { paymentHub } from "@/services/payments";
import { Helmet } from "react-helmet-async";

export default function CheckoutPage() {
  const [params] = useSearchParams();
  const planId = (params.get("plan") as PlanId) || "student_pro";
  const credits = params.get("credits");
  const plan = getPlan(planId);
  const isCredits = !!credits;

  const [promo, setPromo] = useState("");
  const [discount, setDiscount] = useState(0);
  const [success, setSuccess] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [orderRef, setOrderRef] = useState("");

  const subtotal = isCredits
    ? (CREDIT_PACKS[credits!]?.price ?? 0)
    : plan.priceMonthly;
  const discountAmt = Math.round(subtotal * (discount / 100));
  const total = subtotal - discountAmt;
  const dryRun = paymentHub.dryRun();

  const applyPromo = () => {
    const pct = resolvePromo(promo);
    if (!promo.trim()) { toast.error("Enter a code"); return; }
    if (pct > 0) { setDiscount(pct); toast.success(`${pct}% off applied`); }
    else { setDiscount(0); toast.error("Invalid promo code"); }
  };

  const confirm = async () => {
    setProcessing(true);
    try {
      const result = isCredits
        ? await checkoutCredits(credits!, discount)
        : await checkoutPlan(planId, "monthly", discount);

      if (result.redirectUrl) {
        toast.message("Redirecting to payment...");
        window.location.href = result.redirectUrl;
        return;
      }
      if (result.completed) {
        setOrderRef(result.intent.providerRef ?? result.intent.id);
        setSuccess(true);
        toast.success(result.intent.simulated ? "Sandbox purchase recorded" : "Payment successful");
      } else {
        toast.error("Payment did not complete. Please try again.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card>
          <CardHeader className="items-center text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
            <CardTitle>{dryRun ? "Sandbox purchase complete" : "Purchase complete"}</CardTitle>
            <CardDescription>
              {isCredits
                ? `${credits} AI credits added to your balance.`
                : `Welcome to ${plan.name}.`}{" "}
              {dryRun && "No real payment was processed (dry-run mode)."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Order ID</span><span>{orderRef}</span></div>
            <div className="flex justify-between"><span>Amount</span><span>PKR {total.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Status</span><span>{dryRun ? "Sandbox" : "Paid"}</span></div>
            <Separator className="my-3" />
            <div className="flex gap-2">
              <Button asChild className="flex-1"><Link to="/billing">Go to billing</Link></Button>
              <Button asChild variant="outline" className="flex-1"><Link to="/">Back home</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Helmet><title>Checkout — ResearchCollab</title></Helmet>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <h1 className="text-2xl font-bold">Checkout</h1>
          {dryRun && <Badge variant="secondary">Sandbox</Badge>}
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Your selection</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {isCredits ? `${credits} AI Credits Top-up` : `${plan.name} subscription`}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {isCredits ? "One-time purchase" : "Monthly • cancel anytime"}
                    </div>
                  </div>
                  <div className="font-semibold">PKR {subtotal.toLocaleString()}</div>
                </div>
                {!isCredits && (
                  <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                    {plan.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{f}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" />Promo code</CardTitle></CardHeader>
              <CardContent className="flex gap-2">
                <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="RCOLLAB20" />
                <Button variant="outline" onClick={applyPromo}>Apply</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" />Payment method</CardTitle>
                <CardDescription>
                  {dryRun
                    ? "Sandbox mode — no real charge. Confirm records a test order."
                    : "You'll be redirected to JazzCash / Easypaisa to pay securely."}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Escrow-backed • Refundable
              </CardContent>
            </Card>
          </div>

          <Card className="h-fit">
            <CardHeader><CardTitle className="text-base">Order summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>PKR {subtotal.toLocaleString()}</span></div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600"><span>Discount ({discount}%)</span><span>- PKR {discountAmt.toLocaleString()}</span></div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between font-semibold"><span>Total</span><span>PKR {total.toLocaleString()}</span></div>
              <Button className="mt-3 w-full" onClick={confirm} disabled={processing}>
                {processing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : <><Lock className="mr-2 h-4 w-4" />{dryRun ? "Confirm (sandbox)" : "Pay now"}</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
