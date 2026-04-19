import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Wand2,
  Loader2,
  Sparkles,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import WorkflowResult from "@/components/architect/WorkflowResult";

const TEMPLATES = [
  {
    id: "customer-support",
    title: "Customer Support Agent",
    prompt:
      "Build an AI customer support system that handles incoming tickets. It should classify ticket urgency, route technical issues to a code-aware agent, billing issues to an account specialist, and general inquiries to a FAQ lookup. Critical issues need human escalation. The system should ...",
  },
  {
    id: "research-assistant",
    title: "Research & Report Writer",
    prompt:
      "Create an AI research assistant that takes a topic, searches the web and internal knowledge bases for relevant information, synthesizes findings into a structured report with citations, fact-checks key claims, and produces a final document in a specified format. The research domain is ...",
  },
  {
    id: "code-review-pipeline",
    title: "Code Review Pipeline",
    prompt:
      "Design an automated code review system that receives pull requests, runs static analysis, checks for security vulnerabilities, evaluates code style and best practices, generates improvement suggestions, and produces a summary review. The codebase is primarily ...",
  },
  {
    id: "data-etl",
    title: "Data ETL Orchestrator",
    prompt:
      "Build an AI-powered ETL pipeline that ingests data from multiple APIs, validates and cleans the data, transforms it according to business rules, handles schema mismatches and missing fields gracefully, loads results into a database, and generates a quality report. The data sources include ...",
  },
  {
    id: "content-moderation",
    title: "Content Moderation System",
    prompt:
      "Create a content moderation pipeline for a social platform that screens text posts, images, and links. It should classify content by risk level, auto-approve safe content, flag borderline cases for human review, and immediately block policy violations. Categories include ...",
  },
];

export default function WorkflowArchitect() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function handleAnalyze() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "decompose-workflow",
        { body: { prompt: prompt.trim() } }
      );

      if (fnError) {
        throw new Error(fnError.message || "Failed to analyze workflow");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResult(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">
              Workflow Architect
            </h1>
          </div>
          <span className="text-xs text-muted-foreground">
            Describe a task. Get the optimal agent architecture.
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Input */}
          <div className="lg:col-span-1 space-y-5">
            {/* Prompt input */}
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Describe your task
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Build an AI agent that..."
                className="w-full h-48 rounded-lg bg-card border border-border p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-muted-foreground">
                  {prompt.length} characters
                </span>
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !prompt.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {loading ? "Analyzing..." : "Decompose"}
                </button>
              </div>
            </div>

            {/* Templates */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Templates
              </h3>
              <div className="space-y-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setPrompt(t.prompt)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-sm text-foreground bg-card/60 border border-border/50 hover:bg-card hover:border-border transition-all group"
                  >
                    <span className="truncate">{t.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Result */}
          <div className="lg:col-span-2">
            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {loading && !result && (
              <div className="flex flex-col items-center justify-center h-80 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-3" />
                <p className="text-sm">Decomposing your task into an optimized workflow...</p>
                <p className="text-xs mt-1">This takes about 10-15 seconds</p>
              </div>
            )}

            {!loading && !result && !error && (
              <div className="flex flex-col items-center justify-center h-80 text-muted-foreground">
                <Wand2 className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">Describe a task or pick a template</p>
                <p className="text-xs mt-1">
                  We'll show you why a single-model approach fails and how to architect it properly
                </p>
              </div>
            )}

            {result && (
              <WorkflowResult data={result as never} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
