import { create } from "zustand";
import type {
  AssuranceArtifact,
  AssuranceCapabilities,
  AssuranceEntrySnapshot,
  AssuranceEvalResult,
  AssuranceIssue,
  AssuranceRunResult,
  AssuranceStatus,
  GraphPatchPreview,
} from "@/types/assurance";

interface AssuranceState {
  available: boolean;
  enabled: boolean;
  profile: "baseline" | "assured";
  capabilities: AssuranceCapabilities | null;
  status: AssuranceStatus;
  entrySnapshot: AssuranceEntrySnapshot | null;
  compiledSemanticIdentity: string | null;
  compiledMaxOuterRevisions: number | null;
  artifact: AssuranceArtifact | null;
  issues: AssuranceIssue[];
  warnings: AssuranceIssue[];
  run: AssuranceRunResult | null;
  evalResult: AssuranceEvalResult | null;
  patchPreview: GraphPatchPreview | null;
  maxOuterRevisions: number;
  fixtureMode: "clean" | "invalid_output" | "handoff_drift" | "evidence_failure";
  busy: "capabilities" | "compile" | "run" | "eval" | "patch" | null;
  error: string | null;

  setCapabilities: (capabilities: AssuranceCapabilities | null) => void;
  enter: (snapshot: AssuranceEntrySnapshot) => void;
  setProfile: (profile: AssuranceState["profile"]) => void;
  exitKeep: () => void;
  exitRevert: () => AssuranceEntrySnapshot | null;
  clearForScenario: () => void;
  setMaxOuterRevisions: (value: number) => void;
  setFixtureMode: (value: AssuranceState["fixtureMode"]) => void;
  setBusy: (busy: AssuranceState["busy"]) => void;
  setError: (error: string | null) => void;
  setCompileFailed: (error: string, issues: AssuranceIssue[]) => void;
  markStaleAgainst: (identity: string) => void;
  setCompiled: (artifact: AssuranceArtifact, semanticIdentity: string, issues?: AssuranceIssue[], warnings?: AssuranceIssue[]) => void;
  setRun: (run: AssuranceRunResult) => void;
  setEval: (result: AssuranceEvalResult) => void;
  setPatchPreview: (preview: GraphPatchPreview | null) => void;
}

const cleared = {
  enabled: false,
  profile: "assured" as const,
  status: "disabled" as const,
  entrySnapshot: null,
  compiledSemanticIdentity: null,
  compiledMaxOuterRevisions: null,
  artifact: null,
  issues: [],
  warnings: [],
  run: null,
  evalResult: null,
  patchPreview: null,
  fixtureMode: "clean" as const,
  maxOuterRevisions: 0,
  busy: null,
  error: null,
};

export const useAssuranceStore = create<AssuranceState>((set, get) => ({
  available: false,
  capabilities: null,
  ...cleared,

  setCapabilities: (capabilities) => set((state) => {
    const available = Boolean(capabilities?.enabled && capabilities.supported);
    if (state.enabled && !available) {
      return {
        ...cleared,
        capabilities,
        available,
        error: "Assurance backend unavailable. Canvas changes were kept.",
      };
    }
    return {
      capabilities,
      available,
      status: !available && capabilities ? "unsupported" : state.status,
      busy: state.busy === "capabilities" ? null : state.busy,
    };
  }),
  enter: (snapshot) => set((state) => state.available ? {
    enabled: true,
    profile: "assured",
    status: "draft",
    entrySnapshot: structuredClone(snapshot),
    artifact: null,
    compiledSemanticIdentity: null,
    issues: [],
    warnings: [],
    run: null,
    evalResult: null,
    patchPreview: null,
    error: null,
  } : state),
  setProfile: (profile) => set((state) => ({
    profile,
    status: state.artifact ? "stale" : "draft",
    run: null,
    evalResult: null,
    error: null,
  })),
  exitKeep: () => set((state) => ({ ...cleared, capabilities: state.capabilities, available: state.available })),
  exitRevert: () => {
    const snapshot = get().entrySnapshot ? structuredClone(get().entrySnapshot) : null;
    set((state) => ({ ...cleared, capabilities: state.capabilities, available: state.available }));
    return snapshot;
  },
  clearForScenario: () => set({ ...cleared, capabilities: null, available: false }),
  setMaxOuterRevisions: (value) => set((state) => {
    const maxOuterRevisions = Math.max(0, Math.min(3, value));
    const stale = state.artifact && state.compiledMaxOuterRevisions !== maxOuterRevisions;
    return {
      maxOuterRevisions,
      ...(stale ? { status: "stale" as const, run: null, evalResult: null } : {}),
    };
  }),
  setFixtureMode: (fixtureMode) => set({ fixtureMode }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error, busy: null }),
  setCompileFailed: (error, issues) => set({ error, issues, status: "draft", busy: null }),
  markStaleAgainst: (identity) => set((state) => {
    if (!state.enabled || !state.compiledSemanticIdentity || state.status === "compiling") return state;
    const stale = identity !== state.compiledSemanticIdentity || state.maxOuterRevisions !== state.compiledMaxOuterRevisions;
    if (stale) return { status: "stale", run: null, evalResult: null };
    if (state.status === "stale") return { status: "compiled" };
    return state;
  }),
  setCompiled: (artifact, compiledSemanticIdentity, issues = [], warnings = []) => set((state) => ({
    artifact,
    compiledSemanticIdentity,
    compiledMaxOuterRevisions: state.maxOuterRevisions,
    status: "compiled",
    issues,
    warnings,
    run: null,
    evalResult: null,
    busy: null,
    error: null,
  })),
  setRun: (run) => set({
    run,
    status: run.terminal_kind === "clean" || run.terminal_kind === "recovered" ? "passed" : "failed",
    busy: null,
    error: null,
  }),
  setEval: (evalResult) => set({ evalResult, status: "checked", busy: null, error: null }),
  setPatchPreview: (patchPreview) => set({ patchPreview, busy: null }),
}));
