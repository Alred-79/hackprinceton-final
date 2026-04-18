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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, BookOpen, Settings, BarChart3 } from "lucide-react";

export default function Simulator() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const loadScenario = useSimulatorStore((s) => s.loadScenario);
  const currentScenario = useSimulatorStore((s) => s.currentScenario);
  const activeRightTab = useSimulatorStore((s) => s.activeRightTab);
  const setActiveRightTab = useSimulatorStore((s) => s.setActiveRightTab);
  const attempts = useSimulatorStore((s) => s.attempts);
  const [showEditorial, setShowEditorial] = useState(false);

  useEffect(() => {
    if (!scenarioId) return;
    const scenario = getScenarioById(scenarioId);
    if (scenario) {
      loadScenario(scenario);
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
      <div className="flex items-center gap-3 border-b px-4 py-2 bg-card/50 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Scenarios
        </Button>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-sm font-semibold text-foreground">{currentScenario.title}</h1>
        <span className="text-xs text-muted-foreground">{currentScenario.brief}</span>
        <div className="flex-1" />
        {editorialUnlocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEditorial(true)}
            className="gap-1 text-xs"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Editorial
          </Button>
        )}
      </div>

      {/* HUD */}
      <div className="px-4 py-2 shrink-0">
        <HUD />
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar - Node Palette */}
        <div className="w-48 border-r bg-card/30 shrink-0">
          <ScrollArea className="h-full p-3">
            <NodePalette />
          </ScrollArea>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <Canvas />
        </div>

        {/* Right sidebar - Inspector / Results */}
        <div className="w-72 border-l bg-card/30 shrink-0 flex flex-col">
          <Tabs
            value={activeRightTab}
            onValueChange={(v) => setActiveRightTab(v as "inspector" | "results")}
            className="flex flex-col h-full"
          >
            <TabsList className="grid grid-cols-2 mx-3 mt-3 shrink-0">
              <TabsTrigger value="inspector" className="text-xs gap-1">
                <Settings className="h-3 w-3" />
                Inspector
              </TabsTrigger>
              <TabsTrigger value="results" className="text-xs gap-1">
                <BarChart3 className="h-3 w-3" />
                Results
              </TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0">
              <TabsContent value="inspector" className="h-full m-0">
                <ScrollArea className="h-full px-3 py-2">
                  <InspectorPanel />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="results" className="h-full m-0">
                <ScrollArea className="h-full px-3 py-2">
                  <ResultsPanel />
                </ScrollArea>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Editorial modal */}
      {showEditorial && <Editorial onClose={() => setShowEditorial(false)} />}
    </div>
  );
}
