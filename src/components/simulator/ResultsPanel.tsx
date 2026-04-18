import { useSimulatorStore } from "@/store/simulatorStore";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ResultsPanel() {
  const deterministicResults = useSimulatorStore((s) => s.deterministicResults);
  const llmResults = useSimulatorStore((s) => s.llmResults);
  const isLLMLoading = useSimulatorStore((s) => s.isLLMLoading);
  const resultsStale = useSimulatorStore((s) => s.resultsStale);
  const scenario = useSimulatorStore((s) => s.currentScenario);

  if (!deterministicResults) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
        Click "Run" to evaluate your architecture
      </div>
    );
  }

  const costOk = scenario ? deterministicResults.cost <= scenario.maxCost : true;
  const latencyOk = scenario ? deterministicResults.latency <= scenario.maxLatency : true;
  const reliabilityOk = scenario ? deterministicResults.reliability >= scenario.minReliability : true;
  const deterministicPass = costOk && latencyOk && reliabilityOk;

  const llmPass = llmResults
    ? llmResults.overall.architectureScore >= (scenario?.llmThresholds.minArchitectureScore || 0) &&
      llmResults.overall.promptScore >= (scenario?.llmThresholds.minPromptScore || 0)
    : false;

  const overallPass = deterministicPass && (llmResults ? llmPass : false);

  return (
    <ScrollArea className="h-full">
      <div className={cn("space-y-4 p-1", resultsStale && "opacity-60")}>
        {resultsStale && (
          <Badge variant="outline" className="text-xs">
            Previous run - graph has changed
          </Badge>
        )}

        {/* Overall result */}
        <div className={cn(
          "rounded-lg border p-3 text-center",
          overallPass
            ? "border-emerald-500/50 bg-emerald-500/10"
            : isLLMLoading
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-destructive/50 bg-destructive/10"
        )}>
          {isLLMLoading ? (
            <div className="flex items-center justify-center gap-2 text-amber-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Analyzing prompts...</span>
            </div>
          ) : overallPass ? (
            <div className="flex items-center justify-center gap-2 text-emerald-400">
              <CheckCircle className="h-5 w-5" />
              <span className="text-sm font-semibold">PASS</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="text-sm font-semibold">FAIL</span>
            </div>
          )}
        </div>

        {/* Deterministic scores */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Architecture Metrics</h4>
          <ScoreRow label="Cost" value={`$${deterministicResults.cost}`} ok={costOk} />
          <ScoreRow label="Latency" value={`${deterministicResults.latency}s`} ok={latencyOk} />
          <ScoreRow label="Reliability" value={`${deterministicResults.reliability}%`} ok={reliabilityOk} />
        </div>

        {/* Bonuses & Penalties */}
        {(deterministicResults.bonuses.length > 0 || deterministicResults.penalties.length > 0) && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">Breakdown</h4>
            {deterministicResults.bonuses.map((b, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="text-emerald-400 font-medium">+{b.value}%</span>
              </div>
            ))}
            {deterministicResults.penalties.map((p, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{p.label}</span>
                <span className="text-destructive font-medium">{p.value}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {deterministicResults.warnings.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-amber-400 uppercase flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Warnings
            </h4>
            {deterministicResults.warnings.map((w, i) => (
              <p key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{w}</p>
            ))}
          </div>
        )}

        {/* LLM Results */}
        {isLLMLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for prompt analysis...
          </div>
        )}

        {llmResults && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">Prompt Analysis (AI)</h4>
            
            <div className="grid grid-cols-2 gap-2">
              <ScoreBox
                label="Architecture"
                score={llmResults.overall.architectureScore}
                threshold={scenario?.llmThresholds.minArchitectureScore || 0}
              />
              <ScoreBox
                label="Prompt Quality"
                score={llmResults.overall.promptScore}
                threshold={scenario?.llmThresholds.minPromptScore || 0}
              />
            </div>

            <p className="text-xs text-muted-foreground">{llmResults.overall.feedback}</p>

            {llmResults.overall.suggestions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-foreground">Suggestions:</p>
                {llmResults.overall.suggestions.map((s, i) => (
                  <p key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                    {s}
                  </p>
                ))}
              </div>
            )}

            {/* Per-node feedback */}
            {llmResults.perNode.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">Per-Node Feedback:</p>
                {llmResults.perNode.map((pn) => (
                  <div key={pn.nodeId} className="text-xs border border-border rounded p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{pn.nodeId}</span>
                      <Badge variant={pn.promptScore >= 60 ? "default" : "destructive"} className="text-[10px]">
                        {pn.promptScore}/100
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{pn.feedback}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isLLMLoading && !llmResults && deterministicResults && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            Prompt analysis unavailable - showing deterministic results only.
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function ScoreRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", ok ? "text-emerald-400" : "text-destructive")}>
        {value} {ok ? <CheckCircle className="inline h-3 w-3" /> : <XCircle className="inline h-3 w-3" />}
      </span>
    </div>
  );
}

function ScoreBox({ label, score, threshold }: { label: string; score: number; threshold: number }) {
  const ok = score >= threshold;
  return (
    <div className={cn(
      "rounded border p-2 text-center",
      ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
    )}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold", ok ? "text-emerald-400" : "text-destructive")}>{score}</p>
      <p className="text-[10px] text-muted-foreground">min: {threshold}</p>
    </div>
  );
}
