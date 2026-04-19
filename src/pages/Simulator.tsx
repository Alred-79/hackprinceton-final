import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { ArrowLeft, BookOpen, Settings, BarChart3, Blocks, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Simulator() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const loadScenario = useSimulatorStore((s) => s.loadScenario);
  const currentScenario = useSimulatorStore((s) => s.currentScenario);
  const activeRightTab = useSimulatorStore((s) => s.activeRightTab);
  const setActiveRightTab = useSimulatorStore((s) => s.setActiveRightTab);
  const attempts = useSimulatorStore((s) => s.attempts);
  const [showEditorial, setShowEditorial] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!scenarioId) return;
    const scenario = getScenarioById(scenarioId);
    if (scenario) {
      loadScenario(scenario);
      setShowIntro(true);
    } else {
      navigate("/");
    }
  }, [scenarioId, loadScenario, navigate]);

  if (!currentScenario) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        Loading scenario...
      </div>
    );
  }

  const editorialUnlocked = attempts >= 3 && !!currentScenario.editorial;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-2 bg-card/60 backdrop-blur-sm shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Scenarios
        </Button>
        <div className="h-4 w-px bg-border/50" />
        <h1 className="text-sm font-semibold text-foreground">{currentScenario.title}</h1>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowIntro(true)}
          className="gap-1.5 text-xs border-rose-400/30 text-rose-400 hover:bg-rose-400/10 hover:text-rose-300 hover:border-rose-400/50"
        >
          <ScrollText className="h-3.5 w-3.5" />
          Problem Statement
        </Button>
        {editorialUnlocked && (
          <>
            <div className="h-4 w-px bg-border/50" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditorial(true)}
              className="gap-1 text-xs"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Editorial
            </Button>
          </>
        )}
      </div>

      {/* HUD */}
      <div className="px-4 py-2 shrink-0 border-b border-border/30">
        <HUD />
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar - Node Palette */}
        <div className="w-52 shrink-0 flex flex-col border-r border-border/40 bg-gradient-to-b from-card/50 to-card/20">
          <div className="px-3 pt-3 pb-2 border-b border-border/30">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Blocks className="h-3.5 w-3.5 text-primary" />
              Node Palette
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Drag onto canvas or click
            </p>
          </div>
          <ScrollArea className="flex-1 px-3 py-2">
            <NodePalette />
          </ScrollArea>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <Canvas />
        </div>

        {/* Right sidebar - Inspector / Results */}
        <div className="w-80 shrink-0 flex flex-col border-l border-border/40 bg-gradient-to-b from-card/50 to-card/20">
          {/* Custom tab header */}
          <div className="flex border-b border-border/30 shrink-0">
            <button
              onClick={() => setActiveRightTab("inspector")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors relative",
                activeRightTab === "inspector"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              Inspector
              {activeRightTab === "inspector" && (
                <div className="absolute bottom-0 inset-x-4 h-0.5 bg-primary rounded-full" />
              )}
            </button>
            <div className="w-px bg-border/30 my-2" />
            <button
              onClick={() => setActiveRightTab("results")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors relative",
                activeRightTab === "results"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Results
              {activeRightTab === "results" && (
                <div className="absolute bottom-0 inset-x-4 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          </div>

          {/* Tab content */}
          <ScrollArea className="flex-1">
            <div className="px-3 py-3">
              {activeRightTab === "inspector" ? <InspectorPanel /> : <ResultsPanel />}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Scenario intro popup */}
      {showIntro && currentScenario && (
        <ScenarioIntro
          scenario={currentScenario}
          onDismiss={() => setShowIntro(false)}
        />
      )}

      {/* Editorial modal */}
      {showEditorial && <Editorial onClose={() => setShowEditorial(false)} />}
    </div>
  );
}
