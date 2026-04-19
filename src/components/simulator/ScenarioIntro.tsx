import { useState } from "react";
import type { Scenario } from "@/types/simulator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  Hammer,
  Lightbulb,
  ArrowRight,
  Zap,
  AlertTriangle,
  Target,
  X,
} from "lucide-react";

interface IntroContent {
  tagline: string;
  flavor: string;
  situation: string;
  objective: string;
  toolTips: string[];
  proTip?: string;
}

const SCENARIO_INTROS: Record<string, IntroContent> = {
  "bloated-swarm": {
    tagline: "7 agents. 1 job. Way too much money.",
    flavor:
      "Someone on the last team really loved copy-paste. They built a customer support bot with a dedicated Claude Opus agent for every single query type -- including password resets. The monthly bill just hit $47k and leadership is not happy.",
    situation:
      "You're looking at a graph with 7 expensive Executor nodes, each running the most premium model available. Every node does roughly the same thing, just with a different label.",
    objective:
      "Consolidate this bloated swarm into 2-3 smart agents. Downgrade models where the task doesn't need deep reasoning. Keep the Router but make it cheaper.",
    toolTips: [
      "Click any Executor node's edit button to change its model",
      "Delete nodes you don't need (select + backspace)",
      "The Router can stay -- just downgrade it to a lighter model",
    ],
    proTip: "Password resets do not need a $15/1k-token model. Start there.",
  },
  "gold-plater": {
    tagline: "o1-preview for everything. Even formatting.",
    flavor:
      "The previous architect had one philosophy: 'just use the best model.' The result? An o1-preview instance classifying text into 3 categories, another one adding bullet points, and a third one doing the actual analysis. Two of these three tasks are trivially simple.",
    situation:
      "You see a clean pipeline: Classifier -> Formatter + Analyzer (parallel) -> Quality Check -> Output. The architecture is fine. The model assignments are absurd.",
    objective:
      "Right-size every node's model. Simple tasks (classify, format) get small models. Complex tasks (analyze) keep capable models. The evaluator doesn't need the most expensive option either.",
    toolTips: [
      "Click each node's edit button to swap the model",
      "Check the cost in the HUD bar -- your target is under $6",
      "You don't need to change any wiring -- just the models",
    ],
    proTip:
      "GPT-4o Mini can classify text just as well as o1-preview -- at 1/30th the cost.",
  },
  "content-machine": {
    tagline: "First drafts never ship. Build the loop.",
    flavor:
      "Marketing wants an AI content pipeline that generates blog posts, social media, and email campaigns. Here's the catch: first-draft AI content almost never meets brand guidelines. You need a system that writes, evaluates, and rewrites until it's actually good -- without the prompt ballooning out of control on each iteration.",
    situation:
      "You're starting from a blank canvas with just Input and Output nodes. You need to design the entire pipeline from scratch.",
    objective:
      "Build a content generation system with a Router (for content types), a Generator, an Evaluator that loops back for rewrites, and critically -- a Context Gate in the loop to prevent prompt bloat.",
    toolTips: [
      "Drag nodes from the left palette onto the canvas",
      "Connect nodes by dragging from one handle to another",
      "The Evaluator node creates feedback loops -- connect its 'fail' output back upstream",
      "A Context Gate between iterations strips old drafts and keeps only the feedback",
    ],
    proTip:
      "Without a Context Gate in the eval loop, each rewrite adds the previous draft + feedback to context. By iteration 3, your prompt is enormous and quality tanks.",
  },
  "safety-net": {
    tagline: "The file system lies 30% of the time. Deal with it.",
    flavor:
      "You're building a document processing system, but the file storage backend is unreliable -- roughly 30% of reads return corrupted or partial data. The naive approach is to slap an evaluator at the end to catch bad output. The problem? The evaluator can't tell the difference between 'the agent reasoned poorly' and 'the agent got garbage input data.'",
    situation:
      "Blank canvas. You need to design a pipeline that reads files, processes documents, and handles failures gracefully -- at the tool level, not at the end.",
    objective:
      "Build a system with File R/W for document reading, a Fallback Router right after it to catch failures, a success path for normal processing, and a failure path for graceful degradation.",
    toolTips: [
      "The Fallback Router node is your key tool -- it checks if the previous tool succeeded or failed",
      "Place it immediately after File R/W, not at the end of the pipeline",
      "Create two paths: success goes to processing, failure goes to a fallback response",
    ],
    proTip:
      "Handle errors where they happen, not where they hurt. An evaluator at the end is too late to fix corrupted input.",
  },
  "mcp-migration": {
    tagline: "12 tools in one context window. Good luck.",
    flavor:
      'Someone built a "Swiss Army Agent" -- a single Executor with 12 tools jammed into its context window: 3 different search tools, file operations, RAG, code execution, and API calls. The model spends half its tokens just reading tool descriptions. Tool selection accuracy is abysmal because the model can\'t distinguish between web_search_news, web_search_academic, and web_search_social.',
    situation:
      "You see one massive Executor node connected directly between Input and Output, carrying 12 tools. It's running Claude Opus because it needs the huge context window just to hold all the tool definitions.",
    objective:
      "Extract tools into 2-3 MCP Servers organized by domain (research, data, comms). Add a Router to classify requests and dispatch to the right domain. Replace the single Opus executor with focused, cheaper agents per domain.",
    toolTips: [
      "Delete the bloated Swiss Army Agent (select it, press backspace)",
      "Add MCP Server nodes from the palette -- configure which tools each one serves",
      "Add a Router after Input to classify the request domain",
      "Each MCP Server should feed a focused Executor using a cheaper model",
    ],
    proTip:
      "Group by domain, not by tool. One MCP server per individual tool is just as bad as having them all loose -- it's the coordination overhead that matters.",
  },
  "ops-center": {
    tagline: "An incident just fired. Build the war room.",
    flavor:
      "It's 2 AM and a P1 alert just came in: 'Service degradation detected in production.' You need an automated incident response system that gathers diagnostic data from multiple sources, triages the severity, and produces a structured incident report. The catch: you can't triage without intelligence -- gather data FIRST, classify SECOND. And system logs? They're unreliable.",
    situation:
      "Blank canvas. This is the most complex scenario -- you need parallel data gathering, error handling, context filtering, severity routing, structured output, and human sign-off for critical incidents.",
    objective:
      "Build: parallel diagnostic gathering (Web Search + File R/W + RAG) -> Fallback Router on logs -> Context Gate to filter noise -> Severity Router -> Response handlers with output schemas -> Human Review for critical path -> Output.",
    toolTips: [
      "Fan out from Input to 3 parallel diagnostic tools (they run simultaneously)",
      "File R/W is unreliable here -- put a Fallback Router right after it",
      "Use a Context Gate (structured sendoff) to filter raw diagnostics before the Router",
      "Add output schemas to response handlers -- structural guarantees beat runtime checks",
      "Critical incidents need Human Review before remediation",
    ],
    proTip:
      "The #1 mistake is routing the raw alert immediately. Without diagnostic data, 'disk full' could mean routine maintenance or production-down. Gather intelligence, then triage.",
  },
  "due-diligence-engine": {
    tagline: "Write the investment memo. Don't hallucinate the numbers.",
    flavor:
      "A PE firm needs an automated due diligence pipeline for M&A targets. Given a company name, research it from multiple sources, handle unreliable legal document retrieval, filter the research down to key findings, draft a structured investment memo, and iterate until quality is sufficient. The critical skill here: managing context across stages AND inside the eval loop -- two different problems requiring two different solutions.",
    situation:
      "Blank canvas. This is the deepest scenario -- you need planning, parallel research, error handling, two-stage context management, structured output, an eval loop with its own context hygiene, and human sign-off.",
    objective:
      "Build: Planner -> parallel research (Web Search + File R/W + RAG) -> Fallback Router on legal docs -> Gap Noter -> Context Gate #1 (filter research) -> Memo Writer (with output schema) -> Evaluator -> Context Gate #2 (strip draft, keep feedback) -> loop back -> Human Review -> Output.",
    toolTips: [
      "Start with a Planner executor that decomposes the research question",
      "Legal docs are unreliable -- Fallback Router + Gap Noter flags what's missing",
      "Context Gate #1 filters raw research (full SEC filings, legal boilerplate) into key findings",
      "Context Gate #2 in the eval loop strips the old draft, keeping only feedback -- this IS the session compaction decision",
      "The Memo Writer needs an output schema for investment memo structure",
      "Investment decisions need partner sign-off -- Human Review before Output",
    ],
    proTip:
      "Two context gates, two different purposes. Gate #1 filters noisy data. Gate #2 manages iteration hygiene. If you only place one, think about which problem is worse: noisy input or bloating loops.",
  },
};

interface ScenarioIntroProps {
  scenario: Scenario;
  onDismiss: () => void;
}

export function ScenarioIntro({ scenario, onDismiss }: ScenarioIntroProps) {
  const [step, setStep] = useState<"intro" | "tips">("intro");
  const intro = SCENARIO_INTROS[scenario.id];

  if (!intro) {
    // Fallback for unknown scenarios
    onDismiss();
    return null;
  }

  const isFixer = scenario.mode === "fixer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-md"
        onClick={onDismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-lg rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Top accent bar */}
        <div
          className={`h-1 ${
            isFixer
              ? "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500"
              : "bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
          }`}
        />

        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors z-10"
        >
          <X className="h-4 w-4" />
        </button>

        {step === "intro" ? (
          <div className="p-6 space-y-4">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    isFixer
                      ? "border-amber-500/40 text-amber-400"
                      : "border-blue-500/40 text-blue-400"
                  }`}
                >
                  {isFixer ? (
                    <Wrench className="h-3 w-3 mr-1" />
                  ) : (
                    <Hammer className="h-3 w-3 mr-1" />
                  )}
                  {isFixer ? "FIXER" : "ARCHITECT"}
                </Badge>
                {scenario.difficulty && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      scenario.difficulty === "easy"
                        ? "border-green-500/40 text-green-400"
                        : scenario.difficulty === "medium"
                        ? "border-yellow-500/40 text-yellow-400"
                        : "border-red-500/40 text-red-400"
                    }`}
                  >
                    {scenario.difficulty.toUpperCase()}
                  </Badge>
                )}
              </div>
              <h2 className="text-xl font-bold text-foreground">
                {scenario.title}
              </h2>
              <p className="text-sm font-medium text-primary italic">
                {intro.tagline}
              </p>
            </div>

            {/* Story */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              {intro.flavor}
            </p>

            {/* What you see */}
            <div className="rounded-lg bg-muted/30 border border-border/40 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Target className="h-3.5 w-3.5 text-primary" />
                What you're looking at
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {intro.situation}
              </p>
            </div>

            {/* Objective */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Zap className="h-3.5 w-3.5 text-primary" />
                Your mission
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {intro.objective}
              </p>
            </div>

            {/* Action button */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={() => setStep("tips")}
                className="flex-1 gap-2"
              >
                Show me how
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={onDismiss} className="text-xs">
                I've got this
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Tips header */}
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-foreground">
                Quick start guide
              </h2>
              <p className="text-xs text-muted-foreground">
                Here's how to approach {scenario.title}
              </p>
            </div>

            {/* Tool tips */}
            <div className="space-y-2">
              {intro.toolTips.map((tip, i) => (
                <div
                  key={i}
                  className="flex gap-3 rounded-lg bg-muted/30 border border-border/30 p-3"
                >
                  <div className="shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {tip}
                  </p>
                </div>
              ))}
            </div>

            {/* Pro tip */}
            {intro.proTip && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Pro tip
                </div>
                <p className="text-xs text-amber-200/70 leading-relaxed">
                  {intro.proTip}
                </p>
              </div>
            )}

            {/* Budget reminder */}
            <div className="rounded-lg bg-muted/20 border border-border/30 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                Budget constraints
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs font-mono font-bold text-foreground">
                    ${scenario.maxCost}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Max cost
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-foreground">
                    {scenario.maxLatency}s
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Max latency
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-foreground">
                    {scenario.minReliability}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Min reliability
                  </div>
                </div>
              </div>
            </div>

            {/* Go button */}
            <Button onClick={onDismiss} className="w-full gap-2">
              Let's build
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
