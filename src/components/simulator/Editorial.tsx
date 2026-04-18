import { useState } from "react";
import { useSimulatorStore } from "@/store/simulatorStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, BookOpen, AlertTriangle, Code, Lightbulb, Eye } from "lucide-react";

interface EditorialProps {
  onClose: () => void;
}

export function Editorial({ onClose }: EditorialProps) {
  const scenario = useSimulatorStore((s) => s.currentScenario);
  const [showOptimalCanvas, setShowOptimalCanvas] = useState(false);

  if (!scenario?.editorial) return null;

  const { explanation, commonMistakes, optimalCode, keyConcepts } = scenario.editorial;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Editorial: {scenario.title}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            {/* Explanation */}
            <section>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                <Lightbulb className="h-4 w-4 text-amber-400" />
                Why the Optimal Solution Works
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{explanation}</p>
            </section>

            {/* Common Mistakes */}
            <section>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Common Mistakes
              </h3>
              <div className="space-y-2">
                {commonMistakes.map((cm, i) => (
                  <div key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-foreground">{cm.mistake}</p>
                    <p className="text-xs text-muted-foreground mt-1">{cm.whyItFails}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Optimal Architecture button */}
            <section>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                <Eye className="h-4 w-4 text-primary" />
                Optimal Architecture
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOptimalCanvas(true)}
                className="gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" />
                Show on Canvas
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Opens a read-only overlay. Your work is preserved underneath.
              </p>
            </section>

            {/* Optimal Code */}
            <section>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                <Code className="h-4 w-4 text-cyan-400" />
                Optimal LangGraph Implementation
              </h3>
              <pre className="rounded-lg bg-muted/80 border border-border p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre">
                {optimalCode}
              </pre>
            </section>

            {/* Key Concepts */}
            <section>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                <Lightbulb className="h-4 w-4 text-emerald-400" />
                Key Concepts
              </h3>
              <ul className="space-y-1">
                {keyConcepts.map((kc, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] mt-0.5 shrink-0">{i + 1}</Badge>
                    {kc}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-6 py-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Optimal canvas overlay (read-only) */}
      {showOptimalCanvas && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex flex-col">
          <div className="flex items-center justify-between border-b px-6 py-3 bg-card">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Optimal Architecture (Read-Only)</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowOptimalCanvas(false)}>
              <X className="h-4 w-4 mr-1" /> Close Overlay
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            {scenario.optimalNodes ? (
              <p>Optimal graph visualization would appear here</p>
            ) : (
              <p>No pre-built optimal architecture for this scenario</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
