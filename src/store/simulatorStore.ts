import { create } from "zustand";
import type {
  SimNode,
  SimEdge,
  SimulatorState,
  Scenario,
  DeterministicResults,
  LLMGradeResponse,
  TraceStep,
  ResultsTab,
} from "@/types/simulator";
import { SCENARIO_ANSWERS } from "@/data/answers";

const MAX_HISTORY = 50;

interface SimulatorActions {
  // Scenario
  loadScenario: (scenario: Scenario) => void;
  
  // Nodes
  addNode: (node: SimNode) => void;
  removeNode: (id: string) => void;
  updateNodeConfig: (id: string, config: Partial<SimNode["config"]>) => void;
  replaceNodeConfig: (id: string, config: SimNode["config"]) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  selectNode: (id: string | null) => void;
  
  // Edges
  addEdge: (edge: SimEdge) => void;
  removeEdge: (id: string) => void;
  
  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  
  // Grading
  setDeterministicResults: (results: DeterministicResults) => void;
  setLLMResults: (results: LLMGradeResponse | null) => void;
  setIsEvaluating: (v: boolean) => void;
  setIsLLMLoading: (v: boolean) => void;
  markResultsStale: () => void;
  
  // Trace
  setTraceSteps: (steps: TraceStep[]) => void;
  setActiveTraceStep: (idx: number | null) => void;
  
  // Hints
  revealNextHint: () => void;
  incrementAttempts: () => void;
  
  // UI
  setActiveRightTab: (tab: "inspector" | "results") => void;
  setActiveResultsTab: (tab: ResultsTab) => void;
  
  // Reset
  resetBoard: () => void;
  restoreGraphSnapshot: (nodes: SimNode[], edges: SimEdge[]) => void;
  applyGraphPatch: (nodes: SimNode[], edges: SimEdge[]) => void;
  
  // Load answer
  loadAnswer: () => void;
}

export const useSimulatorStore = create<SimulatorState & SimulatorActions>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  selectedNodeId: null,
  currentScenario: null,
  deterministicResults: null,
  llmResults: null,
  isEvaluating: false,
  isLLMLoading: false,
  resultsStale: false,
  traceSteps: [],
  activeTraceStep: null,
  history: [],
  historyIndex: -1,
  hintsRevealed: 0,
  attempts: 0,
  activeRightTab: "inspector",
  activeResultsTab: "analysis",

  loadScenario: (scenario) => {
    const nodes = scenario.initialNodes ?? [
      { id: "input-1", type: "input", config: { label: "Input" }, position: { x: 100, y: 300 }, locked: true },
      { id: "output-1", type: "output", config: { label: "Output" }, position: { x: 900, y: 300 }, locked: true },
    ];
    const edges = scenario.initialEdges ?? [];
    set({
      currentScenario: scenario,
      nodes,
      edges,
      selectedNodeId: null,
      deterministicResults: null,
      llmResults: null,
      isEvaluating: false,
      isLLMLoading: false,
      resultsStale: false,
      traceSteps: [],
      activeTraceStep: null,
      history: [{ nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      historyIndex: 0,
      hintsRevealed: 0,
      attempts: 0,
      activeRightTab: "inspector",
      activeResultsTab: "analysis",
    });
  },

  addNode: (node) => {
    get().pushHistory();
    set((s) => ({ nodes: [...s.nodes, node], resultsStale: s.deterministicResults !== null }));
  },

  removeNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (node?.locked) return;
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      resultsStale: s.deterministicResults !== null,
    }));
  },

  updateNodeConfig: (id, config) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...config } } : n)),
      resultsStale: s.deterministicResults !== null,
    }));
  },

  replaceNodeConfig: (id, config) => {
    get().pushHistory();
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, config: structuredClone(config) } : n)),
      resultsStale: s.deterministicResults !== null,
    }));
  },

  updateNodePosition: (id, position) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
  },

  selectNode: (id) => set({ selectedNodeId: id, activeRightTab: "inspector" }),

  addEdge: (edge) => {
    get().pushHistory();
    set((s) => ({ edges: [...s.edges, edge], resultsStale: s.deterministicResults !== null }));
  },

  removeEdge: (id) => {
    get().pushHistory();
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      resultsStale: s.deterministicResults !== null,
    }));
  },

  pushHistory: () => {
    set((s) => {
      const newHistory = s.history.slice(0, s.historyIndex + 1);
      newHistory.push({ nodes: structuredClone(s.nodes), edges: structuredClone(s.edges) });
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    });
  },

  undo: () => {
    const { historyIndex, history, isEvaluating } = get();
    if (isEvaluating || historyIndex <= 0) return;
    const prev = history[historyIndex - 1];
    set({
      nodes: structuredClone(prev.nodes),
      edges: structuredClone(prev.edges),
      historyIndex: historyIndex - 1,
      resultsStale: true,
    });
  },

  redo: () => {
    const { historyIndex, history, isEvaluating } = get();
    if (isEvaluating || historyIndex >= history.length - 1) return;
    const next = history[historyIndex + 1];
    set({
      nodes: structuredClone(next.nodes),
      edges: structuredClone(next.edges),
      historyIndex: historyIndex + 1,
      resultsStale: true,
    });
  },

  setDeterministicResults: (results) => set({ deterministicResults: results, resultsStale: false }),
  setLLMResults: (results) => set({ llmResults: results, isLLMLoading: false }),
  setIsEvaluating: (v) => set({ isEvaluating: v }),
  setIsLLMLoading: (v) => set({ isLLMLoading: v }),
  markResultsStale: () => set({ resultsStale: true }),

  setTraceSteps: (steps) => set({ traceSteps: steps }),
  setActiveTraceStep: (idx) => set({ activeTraceStep: idx }),

  revealNextHint: () => {
    const { hintsRevealed, currentScenario } = get();
    if (currentScenario && hintsRevealed < currentScenario.hints.length) {
      set({ hintsRevealed: hintsRevealed + 1 });
    }
  },

  incrementAttempts: () => set((s) => ({ attempts: s.attempts + 1 })),

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),
  setActiveResultsTab: (tab) => set({ activeResultsTab: tab }),

  resetBoard: () => {
    const scenario = get().currentScenario;
    if (!scenario) return;
    const nodes = scenario.initialNodes ?? [
      { id: "input-1", type: "input", config: { label: "Input" }, position: { x: 100, y: 300 }, locked: true },
      { id: "output-1", type: "output", config: { label: "Output" }, position: { x: 900, y: 300 }, locked: true },
    ];
    const edges = scenario.initialEdges ?? [];
    set({
      nodes,
      edges,
      selectedNodeId: null,
      deterministicResults: null,
      llmResults: null,
      isEvaluating: false,
      isLLMLoading: false,
      resultsStale: false,
      traceSteps: [],
      activeTraceStep: null,
      history: [{ nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      historyIndex: 0,
    });
  },

  restoreGraphSnapshot: (nodes, edges) => {
    get().pushHistory();
    set({
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      selectedNodeId: null,
      deterministicResults: null,
      llmResults: null,
      resultsStale: false,
      traceSteps: [],
      activeTraceStep: null,
    });
  },

  applyGraphPatch: (nodes, edges) => {
    get().pushHistory();
    set({
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      deterministicResults: null,
      llmResults: null,
      resultsStale: false,
      traceSteps: [],
      activeTraceStep: null,
    });
  },

  loadAnswer: () => {
    const scenario = get().currentScenario;
    if (!scenario) return;
    const answer = SCENARIO_ANSWERS[scenario.id];
    if (!answer) return;
    const nodes = structuredClone(answer.nodes);
    const edges = structuredClone(answer.edges);
    get().pushHistory();
    set({
      nodes,
      edges,
      selectedNodeId: null,
      deterministicResults: null,
      llmResults: null,
      isEvaluating: false,
      isLLMLoading: false,
      resultsStale: false,
    });
  },
}));
