import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { GraduationCap, Mail, Lock, ArrowRight, Eye, EyeOff, Loader2, MessageCircle, Copy, Check } from "lucide-react";
import { supportConfig } from "@/config/support";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getRoleBasedRedirect } from "@/contexts/AuthContext";
import { CelebrationOverlay } from "@/components/celebrations";
import { useCelebration, CELEBRATION_PRESETS } from "@/hooks/useCelebration";
import { onSignupComplete } from "@/lib/referral/referralHooks";

const roles = [
  { value: "student", label: "Student", description: "Learn, collaborate, and earn" },
  { value: "researcher", label: "Researcher", description: "Lead projects and mentor" },
  { value: "professional", label: "Professional", description: "Post projects, hire talent, access tools" },
];

// Ensures referral conversion fulfils at most once per browser even across
// re-renders / remounts of this page.
const REFERRAL_FIRED_KEY = "rc_referral_fired";

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const defaultTab = searchParams.get("tab") === "signup" ? "signup" : "signin";
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { user, userRole, profile, signIn, signUp, signInWithGoogle, isLoading: authLoading } = useAuth();
  const { isActive: isCelebrating, config: celebrationConfig, celebrate } = useCelebration();

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && user && userRole) {
      // Fulfil any pending referral conversion exactly once for this user.
      // Safe no-op when there's no stashed ?ref= code (#62/#70).
      try {
        if (localStorage.getItem(REFERRAL_FIRED_KEY) !== user.id) {
          onSignupComplete(user.id)
            .then(() => localStorage.setItem(REFERRAL_FIRED_KEY, user.id))
            .catch(() => { /* non-blocking */ });
        }
      } catch { /* storage blocked -> skip */ }

      // Check if onboarding is completed
      if (!profile?.onboarding_completed) {
        navigate("/onboarding");
      } else {
        const redirectPath = getRoleBasedRedirect(userRole.role);
        navigate(redirectPath);
      }
    }
  }, [user, userRole, profile, authLoading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await signIn(email, password);

    setIsLoading(false);

    if (error) {
      toast({
        title: "Sign in failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRole) {
      toast({
        title: "Role required",
        description: "Please select what you want to do on the platform.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    const { error } = await signUp(email, password, {
      first_name: firstName,
      last_name: lastName,
      role: selectedRole,
    });

    setIsLoading(false);

    if (error) {
      let errorMessage = error.message;
      if (error.message.includes("already registered")) {
        errorMessage = "This email is already registered. Please sign in instead.";
      }
      toast({
        title: "Sign up failed",
        description: errorMessage,
        variant: "destructive",
      });
    } else {
      // Trigger celebration for successful signup
      celebrate(CELEBRATION_PRESETS.signup);
      toast({
        title: "Check your email",
        description: "We've sent a verification link to your email. Please verify to sign in.",
      });
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const copy = (value: string, field: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <CelebrationOverlay isActive={isCelebrating} config={celebrationConfig} />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="text-2xl font-bold">RCollab</span>
        </div>

        <Card>
          <CardHeader>
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <CardContent className="pt-6">
                {/* Sign In Tab */}
                <TabsContent value="signin">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="signin-email" type="email" placeholder="you@example.com" className="pl-10"
                          value={email} onChange={(e) => setEmail(e.target.value)} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password">Password</Label>
                        <Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="signin-password" type={showPassword ? "text" : "password"} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" className="pl-10 pr-10"
                          value={password} onChange={(e) => setPassword(e.target.value)} required />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : <>Sign In<ArrowRight className="ml-2 h-4 w-4" /></>}
                    </Button>
                  </form>
                </TabsContent>

                {/* Sign Up Tab */}
                <TabsContent value="signup">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="first-name">First Name</Label>
                        <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="last-name">Last Name</Label>
                        <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="signup-email" type="email" placeholder="you@example.com" className="pl-10"
                          value={email} onChange={(e) => setEmail(e.target.value)} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="signup-password" type={showPassword ? "text" : "password"} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" className="pl-10 pr-10"
                          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>I want to...</Label>
                      <Select value={selectedRole} onValueChange={setSelectedRole}>
                        <SelectTrigger><SelectValue placeholder="Select your role" /></SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              <span className="font-medium">{role.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">{role.description}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <Checkbox id="terms" required />
                      <Label htmlFor="terms" className="font-normal text-muted-foreground">
                        I agree to the <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
                      </Label>
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : <>Create Account<ArrowRight className="ml-2 h-4 w-4" /></>}
                    </Button>

                    <div className="rounded-lg border bg-muted/40 p-3 text-center text-sm">
                      <span className="text-muted-foreground">Need help signing up?</span>
                      <a href={supportConfig.whatsappUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center justify-center gap-2 text-primary hover:underline">
                        <MessageCircle className="h-4 w-4" /> WhatsApp: +92 318 178 1454
                      </a>
                    </div>
                  </form>
                </TabsContent>

                {/* Social Login */}
                <div className="mt-6">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>
                  <Button type="button" variant="outline" className="mt-4 w-full" onClick={async () => {
                    const { error } = await signInWithGoogle();
                    if (error) {
                      toast({ title: "Google sign-in failed", description: error.message, variant: "destructive" });
                    }
                  }}>
                    Continue with Google
                  </Button>
                </div>
              </CardContent>
            </Tabs>
          </CardHeader>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </motion.div>
    </div>
  );
}
