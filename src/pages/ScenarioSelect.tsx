import { ALL_SCENARIOS } from "@/data/scenarios";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Wrench, PencilRuler, Trophy } from "lucide-react";
import type { ProgressStatus } from "@/types/simulator";
import { cn } from "@/lib/utils";

function getProgress(scenarioId: string): { status: ProgressStatus; attempts: number } {
  try {
    const data = localStorage.getItem(`sim-progress-${scenarioId}`);
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return { status: "not_started", attempts: 0 };
}

const statusColors: Record<ProgressStatus, string> = {
  not_started: "border-border bg-card",
  attempted: "border-amber-500/30 bg-amber-500/5",
  passed: "border-emerald-500/30 bg-emerald-500/5",
  optimal: "border-primary/30 bg-primary/5",
};

const statusBadges: Record<ProgressStatus, { label: string; variant: "outline" | "default" | "destructive" }> = {
  not_started: { label: "Not Started", variant: "outline" },
  attempted: { label: "Attempted", variant: "default" },
  passed: { label: "Passed", variant: "default" },
  optimal: { label: "Optimal", variant: "default" },
};

export default function ScenarioSelect() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Leetcode for Agentic AI
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Master agent architecture by fixing broken systems and designing optimal solutions.
            Each scenario teaches key principles of multi-agent design.
          </p>
        </div>

        {/* Scenario categories */}
        <div className="space-y-8">
          {/* Fixer scenarios */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Wrench className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-foreground">Fixer Scenarios</h2>
              <span className="text-xs text-muted-foreground">Fix broken architectures</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ALL_SCENARIOS.filter((s) => s.mode === "fixer").map((scenario) => {
                const progress = getProgress(scenario.id);
                return (
                  <ScenarioCard
                    key={scenario.id}
                    title={scenario.title}
                    brief={scenario.brief}
                    mode="fixer"
                    progress={progress.status}
                    onClick={() => navigate(`/simulator/${scenario.id}`)}
                  />
                );
              })}
            </div>
          </div>

          {/* Architect scenarios */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <PencilRuler className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-foreground">Architect Scenarios</h2>
              <span className="text-xs text-muted-foreground">Design from scratch</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ALL_SCENARIOS.filter((s) => s.mode === "architect").map((scenario) => {
                const progress = getProgress(scenario.id);
                return (
                  <ScenarioCard
                    key={scenario.id}
                    title={scenario.title}
                    brief={scenario.brief}
                    mode="architect"
                    progress={progress.status}
                    onClick={() => navigate(`/simulator/${scenario.id}`)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({
  title, brief, mode, progress, onClick,
}: {
  title: string;
  brief: string;
  mode: "fixer" | "architect";
  progress: ProgressStatus;
  onClick: () => void;
}) {
  const badge = statusBadges[progress];
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border-2 p-5 transition-all hover:shadow-lg hover:scale-[1.01] group",
        statusColors[progress]
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {mode === "fixer" ? (
            <Wrench className="h-4 w-4 text-amber-400" />
          ) : (
            <PencilRuler className="h-4 w-4 text-blue-400" />
          )}
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {progress === "optimal" && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
          <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-3">{brief}</p>
      <div className="flex items-center text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Start Challenge <ArrowRight className="h-3 w-3 ml-1" />
      </div>
    </button>
  );
}
