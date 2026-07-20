import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getScenarioById } from "@/data/scenarios";
import { useSimulatorStore } from "@/store/simulatorStore";
import { Canvas } from "@/components/simulator/Canvas";
import { HUD } from "@/components/simulator/HUD";
import { NodePalette } from "@/components/simulator/NodePalette";
import { InspectorPanel } from "@/components/simulator/InspectorPanel";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { Editorial } from "@/components/simulator/Editorial";
import { ScenarioIntro } from "@/components/simulator/ScenarioIntro";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Beaker,
  Blocks,
  BookOpen,
  PlayCircle,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { runtimeApi } from "@/lib/runtimeApi";
import { isScenarioExecutable } from "@/lib/runtimeScenarios";
import type {
  RuntimeCapabilities,
  RuntimeConnectionStatus,
  RuntimeScenarioDefinition,
} from "@/types/runtime";
import { useRuntimeStore } from "@/store/runtimeStore";
import { ExecutePanel } from "./runtime/ExecutePanel";
import { EvalPanel } from "./runtime/EvalPanel";
import { assuranceApi, ASSURANCE_CLIENT_ENABLED } from "@/lib/assuranceApi";
import { semanticGraphIdentity } from "@/lib/assuranceGraph";
import { useAssuranceStore } from "@/store/assuranceStore";
import { buildAssuranceStarterPair } from "@/lib/assuranceStarters";

export default function Simulator() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const loadScenario = useSimulatorStore((state) => state.loadScenario);
  const currentScenario = useSimulatorStore((state) => state.currentScenario);
  const activeRightTab = useSimulatorStore((state) => state.activeRightTab);
  const setActiveRightTab = useSimulatorStore((state) => state.setActiveRightTab);
  const setActiveResultsTab = useSimulatorStore((state) => state.setActiveResultsTab);
  const attempts = useSimulatorStore((state) => state.attempts);
  const [showEditorial, setShowEditorial] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [runtimeConnection, setRuntimeConnection] = useState<RuntimeConnectionStatus>("checking");
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities | null>(null);
  const resetRuntimeScenario = useRuntimeStore((state) => state.resetScenario);
  const expandedView = useRuntimeStore((state) => state.expandedView);
  const setExpandedView = useRuntimeStore((state) => state.setExpandedView);
  const clearAssuranceForScenario = useAssuranceStore((state) => state.clearForScenario);

  useEffect(() => {
    if (!scenarioId) return;
    clearAssuranceForScenario();
    const scenario = getScenarioById(scenarioId);
    if (scenario) {
      loadScenario(scenario);
      resetRuntimeScenario(scenario.id);
      setShowIntro(true);
    } else {
      navigate("/app");
    }
  }, [scenarioId, loadScenario, navigate, resetRuntimeScenario, clearAssuranceForScenario]);

  useEffect(() => {
    if (!ASSURANCE_CLIENT_ENABLED || !scenarioId) return;
    let active = true;
    const assurance = useAssuranceStore.getState();
    assurance.setBusy("capabilities");
    assuranceApi.capabilities(scenarioId)
      .then((capabilities) => {
        if (!active) return;
        const assuranceState = useAssuranceStore.getState();
        assuranceState.setCapabilities(capabilities);
        if (!capabilities.enabled || !capabilities.supported || assuranceState.enabled) return;
        try {
          const simulatorState = useSimulatorStore.getState();
          const starter = buildAssuranceStarterPair(scenarioId, capabilities);
          if (!starter || simulatorState.currentScenario?.id !== scenarioId) return;
          assuranceState.enter({
            nodes: structuredClone(simulatorState.nodes),
            edges: structuredClone(simulatorState.edges),
            historyIndex: simulatorState.historyIndex,
          });
          simulatorState.applyGraphPatch(starter.assured.nodes, starter.assured.edges);
        } catch (error) {
          useAssuranceStore.getState().setError(
            error instanceof Error ? error.message : "The assured starter could not be applied.",
          );
        }
      })
      .catch(() => {
        if (active) useAssuranceStore.getState().setCapabilities(null);
      });
    return () => { active = false; };
  }, [scenarioId]);

  useEffect(() => {
    if (!ASSURANCE_CLIENT_ENABLED) return;
    const mark = (state: ReturnType<typeof useSimulatorStore.getState>) => {
      try {
        const assurance = useAssuranceStore.getState();
        assurance.markStaleAgainst(semanticGraphIdentity(state.nodes, state.edges, assurance.capabilities));
      } catch (error) {
        useAssuranceStore.getState().setError(error instanceof Error ? error.message : "Canvas serialization failed");
      }
    };
    mark(useSimulatorStore.getState());
    return useSimulatorStore.subscribe(mark);
  }, []);

  useEffect(() => {
    const legacyView = searchParams.get("view");
    if (legacyView !== "execute" && legacyView !== "evals") return;
    setActiveRightTab("results");
    setActiveResultsTab(legacyView === "execute" ? "execution" : "evals");
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setSearchParams(next, { replace: true });
  }, [searchParams, setActiveResultsTab, setActiveRightTab, setSearchParams]);

  useEffect(() => {
    let active = true;
    runtimeApi.capabilities()
      .then((capabilities) => {
        if (!active) return;
        setRuntimeCapabilities(capabilities);
        setRuntimeConnection("online");
      })
      .catch(() => {
        if (!active) return;
        setRuntimeCapabilities(null);
        setRuntimeConnection("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  if (!currentScenario) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading scenario...
      </div>
    );
  }

  const editorialUnlocked = attempts >= 3 && !!currentScenario.editorial;
  const executable = isScenarioExecutable(currentScenario.id, runtimeCapabilities);
  const runtimeDefinition = runtimeCapabilities?.scenario_runtimes.find(
    (item) => item.scenario_id === currentScenario.id,
  ) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border/50 bg-card/60 px-4 py-2 backdrop-blur-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app")} className="shrink-0 gap-1 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Scenarios
        </Button>
        <div className="h-4 w-px shrink-0 bg-border/50" />
        <div className="flex shrink-0 items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground">{currentScenario.title}</h1>
          <ScenarioRuntimeBadge connection={runtimeConnection} executable={executable} />
        </div>

        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowIntro(true)}
          className="shrink-0 gap-1.5 border-rose-400/30 text-xs text-rose-400 hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-300"
        >
          <ScrollText className="h-3.5 w-3.5" />
          Problem Statement
        </Button>
        {editorialUnlocked && (
          <>
            <div className="h-4 w-px shrink-0 bg-border/50" />
            <Button variant="outline" size="sm" onClick={() => setShowEditorial(true)} className="shrink-0 gap-1 text-xs">
              <BookOpen className="h-3.5 w-3.5" />
              Editorial
            </Button>
          </>
        )}
      </div>

      <DesignWorkspace
        activeRightTab={activeRightTab}
        setActiveRightTab={setActiveRightTab}
        runtimeConnection={runtimeConnection}
        executable={executable}
        runtimeDefinition={runtimeDefinition}
      />

      {showIntro && (
        <ScenarioIntro scenario={currentScenario} onDismiss={() => setShowIntro(false)} />
      )}
      {showEditorial && <Editorial onClose={() => setShowEditorial(false)} />}
      {expandedView && executable && runtimeConnection === "online" && (
        <RuntimeResultsOverlay
          scenarioId={currentScenario.id}
          scenarioTitle={currentScenario.title}
          runtimeDefinition={runtimeDefinition}
          view={expandedView}
          onViewChange={(view) => {
            setExpandedView(view);
            setActiveResultsTab(view);
          }}
          onClose={() => setExpandedView(null)}
        />
      )}
    </div>
  );
}

function DesignWorkspace({
  activeRightTab,
  setActiveRightTab,
  runtimeConnection,
  executable,
  runtimeDefinition,
}: {
  activeRightTab: "inspector" | "results";
  setActiveRightTab: (tab: "inspector" | "results") => void;
  runtimeConnection: RuntimeConnectionStatus;
  executable: boolean;
  runtimeDefinition: RuntimeScenarioDefinition | null;
}) {
  return (
    <>
      <div className="shrink-0 border-b border-border/30 px-4 py-2">
        <HUD />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-52 shrink-0 flex-col border-r border-border/40 bg-gradient-to-b from-card/50 to-card/20">
          <div className="border-b border-border/30 px-3 pb-2 pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Blocks className="h-3.5 w-3.5 text-primary" />
              Node Palette
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Drag onto canvas or click</p>
          </div>
          <ScrollArea className="flex-1 px-3 py-2">
            <NodePalette />
          </ScrollArea>
        </div>

        <div className="min-w-0 flex-1">
          <Canvas />
        </div>

        <div className="flex w-80 shrink-0 flex-col border-l border-border/40 bg-gradient-to-b from-card/50 to-card/20">
          <div className="flex shrink-0 border-b border-border/30">
            <button
              onClick={() => setActiveRightTab("inspector")}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                activeRightTab === "inspector" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70",
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              Inspector
              {activeRightTab === "inspector" && <div className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
            <div className="my-2 w-px bg-border/30" />
            <button
              onClick={() => setActiveRightTab("results")}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                activeRightTab === "results" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70",
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Results
              {activeRightTab === "results" && <div className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          </div>
          {activeRightTab === "inspector" ? (
            <ScrollArea className="flex-1">
              <div className="px-3 py-3"><InspectorPanel /></div>
            </ScrollArea>
          ) : (
            <div className="min-h-0 flex-1">
              <ResultsPanel
                connectionStatus={runtimeConnection}
                executable={executable}
                runtimeDefinition={runtimeDefinition}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RuntimeResultsOverlay({
  scenarioId,
  scenarioTitle,
  runtimeDefinition,
  view,
  onViewChange,
  onClose,
}: {
  scenarioId: string;
  scenarioTitle: string;
  runtimeDefinition: RuntimeScenarioDefinition | null;
  view: Exclude<ReturnType<typeof useRuntimeStore.getState>["expandedView"], null>;
  onViewChange: (view: "execution" | "evals") => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080b12] text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#080b12]/95 px-5 py-3 backdrop-blur-xl">
        <div>
          <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-cyan-400">Expanded runtime evidence</p>
          <h2 className="mt-0.5 text-sm font-semibold">{scenarioTitle}</h2>
        </div>
        <nav className="ml-5 flex rounded-lg border border-white/10 bg-white/[0.025] p-0.5" aria-label="Expanded runtime view">
          <button
            onClick={() => onViewChange("execution")}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px]", view === "execution" ? "bg-cyan-400/15 text-cyan-200" : "text-muted-foreground")}
          >
            <PlayCircle className="h-3.5 w-3.5" /> Execution
          </button>
          <button
            onClick={() => onViewChange("evals")}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px]", view === "evals" ? "bg-violet-400/15 text-violet-200" : "text-muted-foreground")}
          >
            <Beaker className="h-3.5 w-3.5" /> Evals
          </button>
        </nav>
        <button onClick={onClose} className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] text-muted-foreground hover:bg-white/5 hover:text-white">
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-5 py-6">
        <div className="mx-auto max-w-[1500px]">
          {view === "execution" ? (
            <ExecutePanel
              scenarioId={scenarioId}
              disabled={false}
              runtimeDefinition={runtimeDefinition}
            />
          ) : (
            <EvalPanel scenarioId={scenarioId} disabled={false} />
          )}
        </div>
      </main>
    </div>
  );
}

function ScenarioRuntimeBadge({
  connection,
  executable,
}: {
  connection: RuntimeConnectionStatus;
  executable: boolean;
}) {
  const label = !executable
    ? "Design only"
    : connection === "checking"
      ? "Checking runtime"
      : connection === "offline"
        ? "Runtime offline"
        : "Executable";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium",
      executable && connection === "offline" && "border-red-400/25 bg-red-400/10 text-red-300",
      executable && connection === "checking" && "border-amber-400/25 bg-amber-400/10 text-amber-300",
      connection === "online" && executable && "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
      !executable && "border-border bg-muted/30 text-muted-foreground",
    )}>
      <Activity className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
