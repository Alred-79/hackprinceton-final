import { useSimulatorStore } from "@/store/simulatorStore";
import { computeDeterministicResults } from "@/engine/GradingEngine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Undo2, Redo2, Play, RotateCcw, Info, Lightbulb,
  DollarSign, Clock, ShieldCheck, ChevronDown, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { vibrateWarning, vibrateError, vibrateSuccess, vibratePulse } from "@/lib/vibrate";
import { ContextThermometer } from "./ContextThermometer";
import { withTimeout } from "@/lib/async";
import { isScenarioExecutable } from "@/lib/runtimeScenarios";
import { useRuntimeStore } from "@/store/runtimeStore";
import { ASSURANCE_CLIENT_ENABLED } from "@/lib/assuranceApi";
import { AssuranceControls } from "./AssuranceControls";
import { useAssuranceStore } from "@/store/assuranceStore";

export function HUD() {
  const {
    nodes, edges, currentScenario, isEvaluating, isLLMLoading,
    historyIndex, history, hintsRevealed, attempts,
    setDeterministicResults, setIsEvaluating, setIsLLMLoading,
    setLLMResults, setActiveRightTab, setActiveResultsTab, incrementAttempts,
    undo, redo, revealNextHint, resetBoard, loadAnswer,
  } = useSimulatorStore();

  const [showDetails, setShowDetails] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAnswerConfirm, setShowAnswerConfirm] = useState(false);
  const runPair = useRuntimeStore((state) => state.runPair);
  const runtimeLoading = useRuntimeStore((state) => state.runLoading);
  const selectedFixturePreset = useRuntimeStore(
    (state) => state.selectedFixturePreset,
  );
  const assuranceEnabled = useAssuranceStore((state) => state.enabled);

  const liveMetrics = useMemo(() => {
    if (!currentScenario) return null;
    return computeDeterministicResults(nodes, edges, currentScenario);
  }, [nodes, edges, currentScenario]);

  if (!currentScenario || !liveMetrics) return null;

  const canUndo = historyIndex > 0 && !isEvaluating;
  const canRedo = historyIndex < history.length - 1 && !isEvaluating;

  const costOk = liveMetrics.cost <= currentScenario.maxCost;
  const latencyOk = liveMetrics.latency <= currentScenario.maxLatency;
  const readinessOk = liveMetrics.scenarioReadiness >= currentScenario.minReliability;

  const handleAnalyze = async () => {
    if (!currentScenario) return;
    
    // Vibrate warning if metrics are over budget before running
    if (!costOk || !latencyOk) {
      vibrateWarning();
    }
    setIsEvaluating(true);
    incrementAttempts();
    setDeterministicResults(liveMetrics);
    setActiveRightTab("results");
    setActiveResultsTab("analysis");

    // Start LLM evaluation
    setIsLLMLoading(true);
    try {
      const topology = {
        totalNodes: nodes.length,
        hasCycles: liveMetrics.penalties.some((p) => p.label.includes("Loop")),
        maxToolsOnSingleExecutor: Math.max(
          0, ...nodes.filter((n) => n.type === "executor").map((n) => (n.config.tools || []).length)
        ),
        chainedExecutorsWithoutGate: 0,
        hasEvaluator: nodes.some((n) => n.type === "evaluator"),
        parallelBranches: 0,
      };

      const graphPayload = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          config: n.config,
          connections: {
            incoming: edges.filter((e) => e.target === n.id).map((e) => e.source),
            outgoing: edges.filter((e) => e.source === n.id).map((e) => e.target),
          },
        })),
        edges: edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
        topology,
      };

      const { data, error } = await withTimeout(
        supabase.functions.invoke("grade-solution", {
          body: {
          scenarioId: currentScenario.id,
          scenarioBrief: currentScenario.brief,
          scenarioDescription: currentScenario.description,
          expectedInputs: currentScenario.expectedInputs,
          expectedOutputs: currentScenario.expectedOutputs,
          graph: graphPayload,
          deterministicResults: {
            cost: liveMetrics.cost,
            latency: liveMetrics.latency,
            scenarioReadiness: liveMetrics.scenarioReadiness,
          },
          },
        }),
        20_000,
        "Prompt analysis timed out after 20 seconds.",
      );

      if (error) throw error;
      setLLMResults(data);
      
      // Vibration feedback based on results
      if (data?.overall?.pass) {
        vibrateSuccess();
      } else {
        vibrateError();
      }
    } catch {
      setLLMResults(null);
      vibrateError();
    }
    setIsLLMLoading(false);
    setIsEvaluating(false);
  };

  const handleRunWorkflow = () => {
    setActiveRightTab("results");
    setActiveResultsTab("execution");
    void runPair(currentScenario.id, selectedFixturePreset);
  };

  const handleReset = () => {
    resetBoard();
    setShowResetConfirm(false);
  };

  const attemptsForEditorial = 3;
  const editorialUnlocked = attempts >= attemptsForEditorial;
  const executable = isScenarioExecutable(currentScenario.id, null);

  return (
    <div className="flex flex-col gap-2">
      {ASSURANCE_CLIENT_ENABLED && <AssuranceControls />}
      {/* Metrics bar */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card/80 backdrop-blur px-3 py-2">
        <MetricBadge
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="Cost · estimated"
          value={`$${liveMetrics.intervals.cost.low.toFixed(4)}–$${liveMetrics.intervals.cost.high.toFixed(4)}`}
          threshold={`$${currentScenario.maxCost}`}
          ok={costOk}
        />
        <MetricBadge
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Latency · estimated"
          value={`${liveMetrics.intervals.latency.low.toFixed(1)}–${liveMetrics.intervals.latency.high.toFixed(1)}s`}
          threshold={`${currentScenario.maxLatency}s`}
          ok={latencyOk}
        />
        <MetricBadge
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          label="Scenario readiness · heuristic"
          value={`${liveMetrics.scenarioReadiness}/100`}
          threshold={`${currentScenario.minReliability}/100`}
          ok={readinessOk}
        />

        <div className="h-6 w-px bg-border mx-1" />

        {/* Score breakdown */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              <ChevronDown className="h-3 w-3" />
              Details
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-xs space-y-2">
            {liveMetrics.bonuses.length > 0 && (
              <div>
                <p className="font-semibold text-emerald-400 mb-1">Bonuses</p>
                {liveMetrics.bonuses.map((b, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>{b.label}</span>
                    <span className="text-emerald-400">+{b.value} pts</span>
                  </div>
                ))}
              </div>
            )}
            {liveMetrics.penalties.length > 0 && (
              <div>
                <p className="font-semibold text-destructive mb-1">Penalties</p>
                {liveMetrics.penalties.map((p, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>{p.label}</span>
                    <span className="text-destructive">{p.value} pts</span>
                  </div>
                ))}
              </div>
            )}
            {liveMetrics.warnings.length > 0 && (
              <div>
                <p className="font-semibold text-amber-400 mb-1">Warnings</p>
                {liveMetrics.warnings.map((w, i) => (
                  <p key={i} className="text-muted-foreground">{w}</p>
                ))}
              </div>
            )}
            <div>
              <p className="font-semibold text-cyan-400 mb-1">Assumptions</p>
              {liveMetrics.assumptions.map((assumption) => (
                <p key={assumption} className="text-muted-foreground mb-1">{assumption}</p>
              ))}
              <p className="text-muted-foreground">Task pass: Not measured in Design mode.</p>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} className="h-7 w-7">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} className="h-7 w-7">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowDetails(true)} className="h-7 w-7">
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowResetConfirm(true)}
            disabled={isEvaluating}
            className="h-7 w-7"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowAnswerConfirm(true)}
            disabled={isEvaluating}
            className="h-7 w-7"
            title="Show Answer"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            onClick={handleAnalyze}
            disabled={isEvaluating}
            size="sm"
            className="h-7 gap-1 text-xs ml-1"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {isEvaluating ? "Analyzing..." : "Analyze Design"}
          </Button>
          {executable && !assuranceEnabled && (
            <Button
              onClick={handleRunWorkflow}
              disabled={runtimeLoading !== null}
              size="sm"
              className="h-7 gap-1 text-xs"
            >
              <Play className="h-3.5 w-3.5" />
              {runtimeLoading ? "Running..." : "Run registered baseline"}
            </Button>
          )}
        </div>
      </div>

      {/* Context Thermometer + Hints bar */}
      <div className="flex items-start gap-3">
        <div className="w-56 shrink-0">
          <ContextThermometer />
        </div>

        {/* Hints bar */}
        {currentScenario.hints.length > 0 && (
          <div className="flex items-start gap-2 flex-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { revealNextHint(); vibratePulse(); }}
              disabled={hintsRevealed >= currentScenario.hints.length}
              className="h-7 text-xs gap-1 shrink-0"
            >
              <Lightbulb className="h-3 w-3" />
              Hint ({hintsRevealed}/{currentScenario.hints.length})
            </Button>
            {hintsRevealed > 0 && (
              <div className="flex-1 text-xs text-muted-foreground space-y-0.5">
                {currentScenario.hints.slice(0, hintsRevealed).map((h, i) => (
                  <p key={i} className="bg-muted/50 rounded px-2 py-1">{h}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attempt counter */}
      {attempts > 0 && !editorialUnlocked && (
        <p className="text-xs text-muted-foreground">
          Editorial unlocks after {attemptsForEditorial} attempts ({attempts}/{attemptsForEditorial})
        </p>
      )}

      {/* Scenario details modal */}
      {showDetails && (
        <ScenarioDetailsOverlay onClose={() => setShowDetails(false)} scenario={currentScenario} />
      )}

      {/* Reset confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-lg p-6 max-w-sm shadow-lg space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Reset Board?</h3>
            <p className="text-xs text-muted-foreground">
              This will restore the {currentScenario.mode === "fixer" ? "original broken architecture" : "blank canvas with Input/Output only"}.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleReset}>Reset</Button>
            </div>
          </div>
        </div>
      )}

      {/* Answer confirmation */}
      {showAnswerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border rounded-lg p-6 max-w-sm shadow-lg space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Show Optimal Answer?</h3>
            <p className="text-xs text-muted-foreground">
              This will replace your current architecture with the optimal solution, including properly configured nodes, models, and prompts.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAnswerConfirm(false)}>Cancel</Button>
              <Button size="sm" onClick={() => { loadAnswer(); setShowAnswerConfirm(false); }}>
                <Eye className="h-3.5 w-3.5 mr-1" />
                Show Answer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricBadge({
  icon, label, value, threshold, ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  threshold: string;
  ok: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium border",
      ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        : "border-destructive/30 bg-destructive/10 text-destructive"
    )}>
      {icon}
      <span>{label}: {value}</span>
      <span className="text-muted-foreground">/ {threshold}</span>
    </div>
  );
}

function ScenarioDetailsOverlay({ onClose, scenario }: { onClose: () => void; scenario: NonNullable<ReturnType<typeof useSimulatorStore.getState>["currentScenario"]> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border rounded-lg p-6 max-w-lg w-full shadow-lg space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{scenario.title}</h2>
          <Badge variant={scenario.mode === "fixer" ? "destructive" : "default"}>
            {scenario.mode === "fixer" ? "Fixer" : "Architect"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{scenario.description}</p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="font-semibold text-foreground mb-1">Expected Inputs</p>
            <p className="text-muted-foreground">{scenario.expectedInputs}</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">Expected Outputs</p>
            <p className="text-muted-foreground">{scenario.expectedOutputs}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-border p-2">
            <p className="text-muted-foreground">Max Cost</p>
            <p className="font-semibold text-foreground">${scenario.maxCost}</p>
          </div>
          <div className="rounded border border-border p-2">
            <p className="text-muted-foreground">Max Latency</p>
            <p className="font-semibold text-foreground">{scenario.maxLatency}s</p>
          </div>
          <div className="rounded border border-border p-2">
            <p className="text-muted-foreground">Readiness Target</p>
            <p className="font-semibold text-foreground">{scenario.minReliability}/100</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onClose} className="w-full">Close</Button>
      </div>
    </div>
  );
}
