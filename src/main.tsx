import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { captureReferralFromUrl } from "@/lib/referral/referralHooks";

// Capture a referral code (?ref=CODE) the instant someone lands via a referral
// link, before React mounts, so it survives the signup flow (#62/#63).
try {
  captureReferralFromUrl();
} catch {
  // Never let referral capture block app startup.
}

createRoot(document.getElementById("root")!).render(<App />);
