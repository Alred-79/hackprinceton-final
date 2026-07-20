import { create } from "zustand";
import { runtimeApi } from "@/lib/runtimeApi";
import type { EvalReport, RunRecord, RunVariant } from "@/types/runtime";

export type ExpandedRuntimeView = "execution" | "evals" | null;

interface RuntimeResultsState {
  scenarioId: string | null;
  selectedFixturePreset: string | null;
  baseline: RunRecord | null;
  hardened: RunRecord | null;
  runLoading: RunVariant | "pair" | null;
  runError: string | null;
  evalReport: EvalReport | null;
  evalLoading: boolean;
  evalError: string | null;
  expandedView: ExpandedRuntimeView;
  resetScenario: (scenarioId: string) => void;
  runVariant: (scenarioId: string, variant: RunVariant, fixturePreset?: string | null) => Promise<void>;
  runPair: (scenarioId: string, fixturePreset?: string | null) => Promise<void>;
  resolveApproval: (decision: "approved" | "denied") => Promise<void>;
  replay: (run: RunRecord) => Promise<void>;
  runEvals: (scenarioId: string) => Promise<void>;
  setExpandedView: (view: ExpandedRuntimeView) => void;
  setSelectedFixturePreset: (preset: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const useRuntimeStore = create<RuntimeResultsState>((set, get) => ({
  scenarioId: null,
  selectedFixturePreset: null,
  baseline: null,
  hardened: null,
  runLoading: null,
  runError: null,
  evalReport: null,
  evalLoading: false,
  evalError: null,
  expandedView: null,

  resetScenario: (scenarioId) => {
    if (get().scenarioId === scenarioId) return;
    set({
      scenarioId,
      selectedFixturePreset: null,
      baseline: null,
      hardened: null,
      runLoading: null,
      runError: null,
      evalReport: null,
      evalLoading: false,
      evalError: null,
      expandedView: null,
    });
  },

  runVariant: async (scenarioId, variant, fixturePreset) => {
    get().resetScenario(scenarioId);
    set({ runLoading: variant, runError: null });
    try {
      const result = await runtimeApi.run(scenarioId, variant, fixturePreset);
      if (get().scenarioId !== scenarioId) return;
      set(variant === "baseline" ? { baseline: result } : { hardened: result });
    } catch (error) {
      if (get().scenarioId === scenarioId) {
        set({ runError: errorMessage(error, "The runtime request failed.") });
      }
    } finally {
      if (get().scenarioId === scenarioId) set({ runLoading: null });
    }
  },

  runPair: async (scenarioId, fixturePreset) => {
    get().resetScenario(scenarioId);
    set({ runLoading: "pair", runError: null });
    try {
      const baseline = await runtimeApi.run(scenarioId, "baseline", fixturePreset);
      if (get().scenarioId !== scenarioId) return;
      set({ baseline });
      const hardened = await runtimeApi.run(scenarioId, "hardened", fixturePreset);
      if (get().scenarioId !== scenarioId) return;
      set({ hardened });
    } catch (error) {
      if (get().scenarioId === scenarioId) {
        set({ runError: errorMessage(error, "The paired run failed.") });
      }
    } finally {
      if (get().scenarioId === scenarioId) set({ runLoading: null });
    }
  },

  resolveApproval: async (decision) => {
    const hardened = get().hardened;
    if (!hardened) return;
    const approval = hardened.pending_approvals.find((item) => item.status === "pending");
    if (!approval) return;
    set({ runLoading: "hardened", runError: null });
    try {
      const result = await runtimeApi.resume(
        hardened.run_id,
        approval.approval_id,
        decision,
      );
      if (get().scenarioId === result.scenario_id) set({ hardened: result });
    } catch (error) {
      set({ runError: errorMessage(error, "Approval resume failed.") });
    } finally {
      set({ runLoading: null });
    }
  },

  replay: async (run) => {
    set({ runLoading: run.variant, runError: null });
    try {
      const result = await runtimeApi.replay(run.run_id);
      if (get().scenarioId !== result.scenario_id) return;
      set(result.variant === "baseline" ? { baseline: result } : { hardened: result });
    } catch (error) {
      set({ runError: errorMessage(error, "Fixture replay failed.") });
    } finally {
      set({ runLoading: null });
    }
  },

  runEvals: async (scenarioId) => {
    get().resetScenario(scenarioId);
    set({ evalLoading: true, evalError: null });
    try {
      const report = await runtimeApi.evals(scenarioId);
      if (get().scenarioId === scenarioId) set({ evalReport: report });
    } catch (error) {
      if (get().scenarioId === scenarioId) {
        set({ evalError: errorMessage(error, "The eval suite failed.") });
      }
    } finally {
      if (get().scenarioId === scenarioId) set({ evalLoading: false });
    }
  },

  setExpandedView: (expandedView) => set({ expandedView }),
  setSelectedFixturePreset: (selectedFixturePreset) => set({ selectedFixturePreset }),
}));
