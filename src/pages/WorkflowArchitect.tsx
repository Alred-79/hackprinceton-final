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
    id: "market-intel",
    title: "Live Competitor Intel Feed",
    prompt:
      "My company [YOUR_COMPANY] sells [YOUR_PRODUCT]. Every morning: stream the latest news about our top 3 competitors from the web, hit their pricing APIs to detect changes, cross-reference with our Postgres CRM for deals we lost last month, run sentiment analysis on anything flagged, and push a [bullet-point Slack digest / full PDF brief] before 9am. If a competitor drops pricing by more than 10%, page the sales lead immediately and skip the digest.",
  },
  {
    id: "bug-triage",
    title: "Sentry → Incident Report Bot",
    prompt:
      "I'm an engineer at [YOUR_COMPANY]. When a Sentry alert fires for our [YOUR_SERVICE] service: fetch the stack trace, search our GitHub repo for the relevant files, query Postgres for impacted users in the last hour, check our internal Confluence knowledge base for prior incidents, then draft a [Slack war-room message / full PagerDuty incident report] with a root-cause hypothesis and a suggested fix. Only page on-call if affected users > [YOUR_THRESHOLD].",
  },
  {
    id: "content-repurposer",
    title: "Publish-Once, Repurpose Everywhere",
    prompt:
      "We publish [research papers / podcast transcripts / YouTube videos] about [YOUR_TOPIC]. When a new piece drops: search the web for trending discussions on this topic, pull our past content from the knowledge base for brand consistency, write [3 tweets + a LinkedIn post / a newsletter section / all of the above], fact-check any statistics against live sources, run it through a brand voice evaluator, and only publish if confidence score > 85%. Flag anything that contradicts what we said last quarter.",
  },
  {
    id: "order-pipeline",
    title: "Kafka Order Processing Pipeline",
    prompt:
      "We run an e-commerce platform for [YOUR_INDUSTRY]. Orders stream from Kafka at ~[YOUR_VOLUME] per minute. For each order: validate payment via our billing API, check real-time inventory in our warehouse DB, route [orders over $500 / all orders] through fraud scoring, apply [loyalty tier / promo code / geo-based] discount logic, execute the inventory reservation as a DB transaction, write the confirmed order back, and emit a fulfillment event — all under 2 seconds. Dead-letter anything that fails validation.",
  },
  {
    id: "due-diligence",
    title: "VC / BD Deal Research Bot",
    prompt:
      "I work in [VC / BD / product strategy] at [YOUR_FIRM]. Given a company name: search the web for recent funding rounds and press, scrape their job board to infer engineering priorities, pull SEC filings if they're public, check our internal deal notes database for prior contact, run a SWOT synthesis with citations, iterate the report once if web coverage feels thin, and output a [1-page tearsheet / full investment memo] — [include / exclude] a comparable comps table. Flag anything that looks like they're pivoting.",
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
            onClick={() => navigate("/app")}
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
            Describe any task. Get the optimal agent architecture.
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
                placeholder={"Build an agent that streams from Kafka, queries Postgres, hits 3 external APIs, and only pages someone if confidence < 80%..."}
                className="w-full h-48 rounded-lg bg-card border border-border p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-muted-foreground">
                  Replace <span className="font-mono text-primary/70">[YOUR_X]</span> in templates with your details
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
