import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, ArrowRight, ArrowLeft, Clock, Users,
  AlertTriangle, Brain, ChevronDown, ChevronUp, Star,
} from "lucide-react";
import {
  ProjectType, ComplexityLevel, TeamPreference, DeadlineUrgency,
  ProjectScope, AIEstimate, PricingEstimate, AutoMilestone,
  TalentSuggestion, ToolRecommendation,
  projectTypeLabels, complexityLabels, teamPreferenceLabels, urgencyLabels,
  deliverableOptions, generateEstimate, generatePricing, generateMilestones,
} from "@/data/aiScoping";
import { analyzeScopeWithAI } from "@/lib/ai/scopeAssist";

const AIProjectScopePage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [aiPowered, setAiPowered] = useState(false);

  // Form state
  const [projectType, setProjectType] = useState<ProjectType | "">("");
  const [complexity, setComplexity] = useState<ComplexityLevel | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDeliverables, setSelectedDeliverables] = useState<string[]>([]);
  const [techTools, setTechTools] = useState("");
  const [urgency, setUrgency] = useState<DeadlineUrgency>("standard");
  const [teamPreference, setTeamPreference] = useState<TeamPreference>("solo");

  // Generated results
  const [estimate, setEstimate] = useState<AIEstimate | null>(null);
  const [pricing, setPricing] = useState<PricingEstimate | null>(null);
  const [milestones, setMilestones] = useState<AutoMilestone[]>([]);
  const [adjustedPrice, setAdjustedPrice] = useState<number | null>(null);
  const [talentSuggestions] = useState<TalentSuggestion[]>([]);
  const [toolRecommendations, setToolRecommendations] = useState<ToolRecommendation[]>([]);

  const totalSteps = 6;
  const progress = (step / totalSteps) * 100;

  const handleDeliverableToggle = (deliverable: string) => {
    setSelectedDeliverables((prev) =>
      prev.includes(deliverable) ? prev.filter((d) => d !== deliverable) : [...prev, deliverable],
    );
  };

  const generateResults = async () => {
    setIsGenerating(true);

    const scope: ProjectScope = {
      id: `scope-${Date.now()}`,
      projectType: projectType as ProjectType,
      complexityLevel: complexity as ComplexityLevel,
      title,
      description,
      deliverables: selectedDeliverables,
      techTools: techTools.split(",").map((t) => t.trim()).filter(Boolean),
      deadlineUrgency: urgency,
      teamPreference,
      createdAt: new Date(),
    };

    // Start from the local heuristic, then blend in real credited AI when available.
    let est = generateEstimate(scope);
    let usedAI = false;
    try {
      const ai = await analyzeScopeWithAI({
        title,
        description,
        projectType: String(projectType),
        complexity: String(complexity),
        deliverables: selectedDeliverables,
        techTools: scope.techTools,
      });
      if (ai) {
        usedAI = true;
        est = {
          ...est,
          effortHours: ai.estimatedHours || est.effortHours,
          effortWeeks: ai.estimatedHours ? Math.max(1, Math.round(ai.estimatedHours / 35)) : est.effortWeeks,
          riskLevel: ai.complexity === "high" ? "high" : ai.complexity === "low" ? "low" : est.riskLevel,
          explanation: ai.riskFactors.length
            ? `AI scope analysis. Key risks: ${ai.riskFactors.join("; ")}.`
            : est.explanation,
        };
      }
    } catch {
      // ignore -> heuristic estimate stands
    }

    const price = generatePricing(scope, est);
    const ms = generateMilestones(scope, price);

    setEstimate(est);
    setPricing(price);
    setMilestones(ms);
    setAdjustedPrice(price.recommendedPrice);
    setAiPowered(usedAI);

    const recommendedTools: ToolRecommendation[] = [];
    if (complexity === "advanced" || complexity === "research_grade") {
      recommendedTools.push({
        toolId: "chatgpt-5-3", toolName: "ChatGPT 5.3 Pro",
        reason: "Accelerate development and documentation", timeSaved: "~20 hours",
        monthlyCost: 25, priority: "recommended",
      });
    }
    if (projectType === "research_paper" || projectType === "fyp") {
      recommendedTools.push({
        toolId: "perplexity-pro", toolName: "Perplexity Pro",
        reason: "Research and literature review assistance", timeSaved: "~15 hours",
        monthlyCost: 20, priority: projectType === "research_paper" ? "essential" : "recommended",
      });
    }
    setToolRecommendations(recommendedTools);

    setIsGenerating(false);
    setStep(5);
  };

  const handlePublish = () => {
    toast({ title: "Project Published!", description: "Your AI-scoped project is now live and accepting bids." });
    navigate("/offers");
  };

  const canProceed = () => {
    switch (step) {
      case 1: return projectType !== "";
      case 2: return complexity !== "";
      case 3: return Boolean(title && description && selectedDeliverables.length > 0);
      default: return true;
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 text-center">
          <Badge variant="secondary" className="mb-2"><Sparkles className="mr-1 h-3.5 w-3.5" />AI-Powered Project Scoping</Badge>
          <h1 className="text-2xl font-bold">Scope &amp; Price Your Project</h1>
          <p className="text-sm text-muted-foreground">Let AI help you define, estimate, and price your project in minutes</p>
        </div>

        <div className="mb-6">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Step {step} of {totalSteps}</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <Progress value={progress} />
        </div>

        {step === 1 && (
          <Card>
            <CardHeader><CardTitle>What type of project is this?</CardTitle><CardDescription>Select the category that best describes your project</CardDescription></CardHeader>
            <CardContent>
              <RadioGroup value={projectType} onValueChange={(v) => setProjectType(v as ProjectType)}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(projectTypeLabels).map(([key, label]) => (
                    <Label key={key} htmlFor={`pt-${key}`} className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer">
                      <RadioGroupItem id={`pt-${key}`} value={key} />
                      <span>{label}</span>
                    </Label>
                  ))}
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader><CardTitle>How complex is this project?</CardTitle><CardDescription>This helps us estimate effort and pricing accurately</CardDescription></CardHeader>
            <CardContent>
              <RadioGroup value={complexity} onValueChange={(v) => setComplexity(v as ComplexityLevel)}>
                <div className="space-y-2">
                  {Object.entries(complexityLabels).map(([key, label]) => {
                    const descriptions: Record<string, string> = {
                      basic: "Standard requirements, well-documented, minimal research needed",
                      intermediate: "Some custom requirements, moderate complexity, may need guidance",
                      advanced: "Complex requirements, significant expertise needed, custom solutions",
                      research_grade: "Publication quality, original research, expert supervision recommended",
                    };
                    return (
                      <Label key={key} htmlFor={`cx-${key}`} className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
                        <RadioGroupItem id={`cx-${key}`} value={key} className="mt-1" />
                        <div><div className="font-medium">{label}</div><div className="text-sm text-muted-foreground">{descriptions[key]}</div></div>
                      </Label>
                    );
                  })}
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader><CardTitle>Describe your requirements</CardTitle><CardDescription>Provide details to help us scope accurately</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Project Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ML-based crop disease detector" /></div>
              <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What needs to be built / researched?" /></div>
              <div>
                <Label>Expected Deliverables</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {projectType && deliverableOptions[projectType as ProjectType]?.map((deliverable) => (
                    <Label key={deliverable} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={selectedDeliverables.includes(deliverable)} onCheckedChange={() => handleDeliverableToggle(deliverable)} />
                      {deliverable}
                    </Label>
                  ))}
                </div>
              </div>
              <div><Label>Technologies / Tools Required</Label><Input value={techTools} onChange={(e) => setTechTools(e.target.value)} placeholder="comma,separated,list" /></div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader><CardTitle>Timeline &amp; Team Preferences</CardTitle><CardDescription>Help us match you with the right talent</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label>Deadline Urgency</Label>
                <RadioGroup value={urgency} onValueChange={(v) => setUrgency(v as DeadlineUrgency)} className="mt-2 space-y-2">
                  {Object.entries(urgencyLabels).map(([key, label]) => (
                    <Label key={key} htmlFor={`ur-${key}`} className="flex items-center gap-2"><RadioGroupItem id={`ur-${key}`} value={key} />{label}</Label>
                  ))}
                </RadioGroup>
              </div>
              <div>
                <Label>Team Preference</Label>
                <RadioGroup value={teamPreference} onValueChange={(v) => setTeamPreference(v as TeamPreference)} className="mt-2 space-y-2">
                  {Object.entries(teamPreferenceLabels).map(([key, label]) => (
                    <Label key={key} htmlFor={`tm-${key}`} className="flex items-center gap-2"><RadioGroupItem id={`tm-${key}`} value={key} />{label}</Label>
                  ))}
                </RadioGroup>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 5 && estimate && pricing && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> AI Estimate</CardTitle>
                  <Badge variant="secondary">{aiPowered ? "AI-analyzed" : `${estimate.confidenceScore}% confidence`}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div><div className="text-xl font-bold">{estimate.effortHours}h</div><div className="text-xs text-muted-foreground">Effort</div></div>
                  <div><div className="text-xl font-bold">{estimate.effortWeeks}w</div><div className="text-xs text-muted-foreground">Timeline</div></div>
                  <div><div className="text-xl font-bold">{estimate.suggestedTeamSize}</div><div className="text-xs text-muted-foreground">Team</div></div>
                  <div><div className="text-xl font-bold capitalize">{estimate.riskLevel}</div><div className="text-xs text-muted-foreground">Risk</div></div>
                </div>
                <button className="mt-4 flex items-center gap-1 text-sm text-primary" onClick={() => setShowExplanation(!showExplanation)}>
                  Why this estimate? {showExplanation ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {showExplanation && <p className="mt-2 text-sm text-muted-foreground">{estimate.explanation}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Smart Pricing</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><div className="text-2xl font-bold">${pricing.recommendedPrice}</div><div className="text-sm text-muted-foreground">Range: ${pricing.minPrice} - ${pricing.maxPrice}</div></div>
                <div className="flex justify-between text-sm"><span>Platform Commission</span><span>-${pricing.platformCommission}</span></div>
                <div className="flex justify-between font-semibold"><span>Net to Provider</span><span>${pricing.netToProvider}</span></div>
                <div>
                  <Label>Adjust Price (optional)</Label>
                  <div className="mt-2 flex items-center gap-3">
                    <Slider min={pricing.minPrice} max={pricing.maxPrice} step={5} value={[adjustedPrice ?? pricing.recommendedPrice]} onValueChange={([v]) => setAdjustedPrice(v)} className="flex-1" />
                    <span className="w-16 text-right font-medium">${adjustedPrice}</span>
                  </div>
                  {adjustedPrice !== pricing.recommendedPrice && <p className="mt-1 text-xs text-amber-600">⚠️ Adjusting away from recommended price may affect matching</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Auto-Generated Milestones</CardTitle><CardDescription>Review and edit before publishing</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {milestones.map((ms, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{index + 1}</div>
                    <div className="flex-1"><div className="font-medium">{ms.title}</div><div className="text-sm text-muted-foreground">{ms.description}</div></div>
                    <div className="text-right"><div className="font-semibold">${ms.amount}</div><div className="text-xs text-muted-foreground">{ms.durationDays} days</div></div>
                  </div>
                ))}
              </CardContent>
            </Card>
            {toolRecommendations.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Recommended Tools</CardTitle><CardDescription>Speed up your project with these AI tools</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  {toolRecommendations.map((tool) => (
                    <div key={tool.toolId} className="flex items-center justify-between rounded-lg border p-3">
                      <div><div className="flex items-center gap-2 font-medium">{tool.toolName}<Badge variant="outline">{tool.priority}</Badge></div><div className="text-sm text-muted-foreground">{tool.reason} · Save {tool.timeSaved}</div></div>
                      <div className="text-right"><div className="text-sm">${tool.monthlyCost}/mo</div><Button size="sm" variant="outline" onClick={() => navigate("/tools")}>Add</Button></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back
          </Button>

          {step < 4 && <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>Next<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {step === 4 && (
            <Button onClick={generateResults} disabled={isGenerating}>
              {isGenerating ? <><Sparkles className="mr-2 h-4 w-4 animate-pulse" />Generating...</> : <><Sparkles className="mr-2 h-4 w-4" />Generate AI Estimate</>}
            </Button>
          )}
          {step === 5 && <Button onClick={() => setStep(6)}>Review Milestones<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {step === 6 && <Button onClick={handlePublish}>Publish Project</Button>}
        </div>
      </div>
    </MainLayout>
  );
};

export default AIProjectScopePage;
