import { useMemo, useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Star, Sparkles, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { callAIUniversal, InsufficientCreditsError } from "@/lib/ai/aiUniversalClient";

type Prompt = {
  id: string;
  title: string;
  category: string;
  description: string;
  template: string;
  variables: string[];
};

const PROMPTS: Prompt[] = [
  {
    id: "fyp-idea",
    title: "FYP Idea Improvement",
    category: "FYP",
    description: "Sharpen a raw FYP idea into a focused, novel project.",
    template:
      "I am a final-year student. My FYP idea is: {idea}. My field is {field}. Suggest 3 improved versions of this idea with: a clearer problem statement, a novelty angle, a realistic 6-month scope, and required skills.",
    variables: ["idea", "field"],
  },
  {
    id: "proposal-writer",
    title: "Proposal Writing Support",
    category: "Writing",
    description: "Draft a structured research proposal section.",
    template:
      "Write a 400-word research proposal for: {topic}. Include: background, problem statement, objectives (3), methodology overview, expected outcomes, and timeline.",
    variables: ["topic"],
  },
  {
    id: "lit-review-matrix",
    title: "Literature Review Matrix",
    category: "Research",
    description: "Turn papers into a comparable matrix.",
    template:
      "Build a literature review matrix for the topic: {topic}. For each of 5 typical paper types in this area, provide: author/year placeholder, method, dataset, key finding, limitation, and how it relates to my work.",
    variables: ["topic"],
  },
  {
    id: "methodology",
    title: "Methodology Builder",
    category: "Research",
    description: "Get a step-by-step methodology for your project.",
    template:
      "Design a research methodology for: {topic}. Approach: {approach}. Provide: research design, data collection plan, sample size reasoning, analysis techniques, validity checks, and ethical considerations.",
    variables: ["topic", "approach"],
  },
  {
    id: "viva-questions",
    title: "Viva Question Generator",
    category: "Viva",
    description: "Predict examiner-style questions for your defense.",
    template:
      "I am defending my project on: {topic}. My methodology was: {method}. Generate 15 likely viva questions, ranging from conceptual clarity to methodology critique to future work, with a one-line strong-answer hint for each.",
    variables: ["topic", "method"],
  },
  {
    id: "supervisor-email",
    title: "Supervisor Email Draft",
    category: "Communication",
    description: "Professional email to a supervisor.",
    template:
      "Write a concise, respectful email to my supervisor about: {situation}. Tone: professional but warm. Include a clear ask and propose a next step.",
    variables: ["situation"],
  },
  {
    id: "grant-application",
    title: "Grant Application Section",
    category: "Funding",
    description: "Draft a fundable narrative for a grant.",
    template:
      "Draft a grant application section for the project: {project}. Funder priorities: {priorities}. Cover: significance, innovation, approach, feasibility, and impact metrics. Keep it persuasive and specific.",
    variables: ["project", "priorities"],
  },
  {
    id: "gap-finder",
    title: "Research Gap Finder",
    category: "Research",
    description: "Find open gaps in a field.",
    template:
      "List the top 5 open research gaps in: {field}, focused on the last 3 years. For each gap, give: a one-line description, why it matters, and one feasible student-scale project that would address it.",
    variables: ["field"],
  },
  {
    id: "report-improve",
    title: "Report Section Improvement",
    category: "Writing",
    description: "Tighten and clarify a draft section.",
    template:
      "Improve the following report section for clarity, academic tone, and flow. Keep meaning intact. Flag any unsupported claims.\n\nSection:\n{text}",
    variables: ["text"],
  },
  {
    id: "presentation-script",
    title: "Presentation Script (10 min)",
    category: "Viva",
    description: "Generate a defense presentation outline.",
    template:
      "Create a 10-minute defense presentation script for: {topic}. Include: hook, problem, gap, objectives, method, key results, limitations, future work, and a strong closing line. Mark slide breaks.",
    variables: ["topic"],
  },
  {
    id: "abstract",
    title: "Paper Abstract Generator",
    category: "Writing",
    description: "Write a tight 250-word abstract.",
    template:
      "Write a 250-word academic abstract for a paper on: {topic}. Include: background, problem, method, key findings, and contribution. Structured paragraph, no headings.",
    variables: ["topic"],
  },
  {
    id: "feedback",
    title: "Self-Critique My Work",
    category: "Writing",
    description: "Get tough but fair feedback on a draft.",
    template:
      "Act as a strict reviewer for the following work. List the 5 weakest points, 3 missing arguments, and 3 concrete fixes. Be specific.\n\nWork:\n{text}",
    variables: ["text"],
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(PROMPTS.map((p) => p.category)))];
const FAV_KEY = "rc:ai-prompt-favorites";

export default function AIPromptLibraryPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Prompt | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavorites(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  const toggleFav = (id: string) => {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavorites(next);
    localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
  };

  const filtered = useMemo(() => {
    return PROMPTS.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const openPrompt = (p: Prompt) => {
    setActive(p);
    setVars(Object.fromEntries(p.variables.map((v) => [v, ""])));
    setOutput("");
  };

  const buildFinalPrompt = (): string => {
    if (!active) return "";
    let t = active.template;
    for (const v of active.variables) {
      t = t.split(`{${v}}`).join(vars[v]?.trim() || `[${v}]`);
    }
    return t;
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(buildFinalPrompt());
    toast.success("Prompt copied to clipboard");
  };

  const runPrompt = async () => {
    if (!active) return;
    const missing = active.variables.filter((v) => !vars[v]?.trim());
    if (missing.length) {
      toast.error(`Fill in: ${missing.join(", ")}`);
      return;
    }
    setRunning(true);
    setOutput("");
    try {
      // Credited path: charges AI credits server-side, shows top-up on 402 (#73).
      const data = await callAIUniversal<{ response?: string } & Record<string, unknown>>({
        domain: "research",
        action: "prompt-library",
        context: buildFinalPrompt(),
      });
      const text =
        (data as any)?.response ??
        (data as any)?.text ??
        (data as any)?.output ??
        (typeof data === "string" ? data : JSON.stringify(data, null, 2));
      setOutput(String(text || "(no response)"));
    } catch (e: any) {
      if (e instanceof InsufficientCreditsError) {
        // The top-up toast already fired; leave a helpful inline note.
        setOutput("You're out of AI credits. Top up to run this prompt, or copy it and use it elsewhere.");
      } else {
        toast.error(e?.message || "AI request failed");
        setOutput("AI is unavailable right now. You can still copy the prompt and use it elsewhere.");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-violet-500" /> AI Prompt Library
          </h1>
          <p className="text-sm text-muted-foreground">
            Curated, battle-tested prompts for every stage of your research journey. Copy, customize, or run with AI (uses credits).
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts…" className="pl-9" />
          </div>
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList className="flex-wrap">
              {CATEGORIES.map((c) => (
                <TabsTrigger key={c} value={c}>{c}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{p.title}</CardTitle>
                  <button onClick={() => toggleFav(p.id)} aria-label="Toggle favorite">
                    <Star className={`h-4 w-4 ${favorites.has(p.id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                  </button>
                </div>
                <Badge variant="secondary" className="w-fit">{p.category}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>{p.description}</CardDescription>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => openPrompt(p)}><Sparkles className="mr-1 h-3.5 w-3.5" />Use</Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    await navigator.clipboard.writeText(p.template);
                    toast.success("Template copied");
                  }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No prompts match your search.</p>
          )}
        </div>

        <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
          <DialogContent className="max-w-2xl">
            {active && (
              <>
                <DialogHeader>
                  <DialogTitle>{active.title}</DialogTitle>
                  <DialogDescription>{active.description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {active.variables.map((v) => (
                    <div key={v}>
                      <label className="text-sm font-medium capitalize">{v}</label>
                      <Textarea
                        value={vars[v] ?? ""}
                        onChange={(e) => setVars({ ...vars, [v]: e.target.value })}
                        placeholder={`Enter ${v}…`}
                        rows={v === "text" ? 5 : 2}
                        className="mt-1"
                      />
                    </div>
                  ))}

                  {output && (
                    <div>
                      <div className="mb-1 text-sm font-medium">AI Output</div>
                      <ScrollArea className="max-h-64 rounded-lg border bg-muted/40 p-3">
                        <pre className="whitespace-pre-wrap text-sm">{output}</pre>
                      </ScrollArea>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={copyPrompt}><Copy className="mr-2 h-4 w-4" />Copy Prompt</Button>
                  <Button onClick={runPrompt} disabled={running}>
                    {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running…</> : <><Sparkles className="mr-2 h-4 w-4" />Run with AI</>}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
