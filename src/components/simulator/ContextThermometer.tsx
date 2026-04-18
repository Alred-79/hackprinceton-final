import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSimulatorStore } from "@/store/simulatorStore";
import { Thermometer, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

type PressureLevel = "low" | "moderate" | "high" | "extreme";

function getPressureLevel(toolCount: number): PressureLevel {
  if (toolCount <= 8) return "low";
  if (toolCount <= 16) return "moderate";
  if (toolCount <= 25) return "high";
  return "extreme";
}

const LEVEL_CONFIG: Record<PressureLevel, {
  color: string;
  bg: string;
  border: string;
  label: string;
  fillPercent: number;
}> = {
  low: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/20",
    border: "border-emerald-500/30",
    label: "Low",
    fillPercent: 20,
  },
  moderate: {
    color: "text-amber-400",
    bg: "bg-amber-500/20",
    border: "border-amber-500/30",
    label: "Moderate",
    fillPercent: 50,
  },
  high: {
    color: "text-orange-400",
    bg: "bg-orange-500/20",
    border: "border-orange-500/30",
    label: "High",
    fillPercent: 75,
  },
  extreme: {
    color: "text-red-400",
    bg: "bg-red-500/20",
    border: "border-red-500/30",
    label: "EXTREME",
    fillPercent: 100,
  },
};

export function ContextThermometer() {
  const nodes = useSimulatorStore((s) => s.nodes);

  const toolCount = useMemo(() => {
    return nodes.reduce((sum, n) => {
      if (n.type === "executor") {
        return sum + (n.config.tools?.length ?? 0);
      }
      return sum;
    }, 0);
  }, [nodes]);

  const totalNodes = nodes.length;
  const level = getPressureLevel(toolCount);
  const config = LEVEL_CONFIG[level];
  const isExtreme = level === "extreme";

  // Context pressure from total node count too
  const nodePressure = Math.min(100, (totalNodes / 20) * 100);
  const combinedFill = Math.max(config.fillPercent, nodePressure);

  return (
    <motion.div
      animate={isExtreme ? {
        x: [0, -2, 2, -2, 2, 0],
        transition: { duration: 0.4, repeat: Infinity, repeatDelay: 1.5 },
      } : {}}
      className={cn(
        "relative rounded-lg border px-3 py-2 transition-colors duration-300",
        config.border,
        config.bg,
      )}
    >
      {/* Steam effect for extreme */}
      <AnimatePresence>
        {isExtreme && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={`steam-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${20 + i * 30}%`,
                  bottom: "100%",
                }}
                initial={{ opacity: 0, y: 0 }}
                animate={{
                  opacity: [0, 0.6, 0],
                  y: [0, -20, -35],
                  x: [0, (i - 1) * 4, (i - 1) * 8],
                }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  delay: i * 0.6,
                  ease: "easeOut",
                }}
              >
                <div className="w-2 h-2 rounded-full bg-red-400/40 blur-sm" />
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <div className={cn("shrink-0", config.color)}>
          {isExtreme ? (
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.6, repeat: Infinity }}
            >
              <Flame className="h-4 w-4" />
            </motion.div>
          ) : (
            <Thermometer className="h-4 w-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider", config.color)}>
              Context: {config.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {totalNodes} nodes / {toolCount} tools
            </span>
          </div>

          {/* Thermometer bar */}
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <motion.div
              className={cn(
                "h-full rounded-full",
                isExtreme ? "thermo-extreme-fill" : "",
              )}
              style={{
                background: isExtreme
                  ? "linear-gradient(90deg, #f97316, #ef4444, #dc2626)"
                  : level === "high"
                  ? "linear-gradient(90deg, #f59e0b, #f97316)"
                  : level === "moderate"
                  ? "linear-gradient(90deg, #22c55e, #f59e0b)"
                  : "linear-gradient(90deg, #22c55e, #22c55e)",
              }}
              initial={{ width: 0 }}
              animate={{ width: `${combinedFill}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>

      {isExtreme && (
        <motion.p
          className="text-[9px] text-red-400/80 mt-1"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          Critical context pressure! Consider adding Context Gates or reducing tools.
        </motion.p>
      )}
    </motion.div>
  );
}
