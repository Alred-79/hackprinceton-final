import { beforeEach, describe, expect, it } from "vitest";
import { useAssuranceStore } from "./assuranceStore";
import type { AssuranceArtifact, AssuranceCapabilities } from "@/types/assurance";

const capabilities: AssuranceCapabilities = {
  enabled: true,
  supported: true,
  scenario_id: "threat-analyst",
  operations: [],
  output_contracts: [],
  handoff_contracts: [],
  evidence_checks: [],
};

const artifact: AssuranceArtifact = {
  artifact_id: "artifact-1",
  scenario_id: "threat-analyst",
  source_graph_hash: "a".repeat(64),
  candidate_hash: "b".repeat(64),
};

describe("assurance lifecycle", () => {
  beforeEach(() => useAssuranceStore.getState().clearForScenario());

  it("requires both enabled and supported server capability", () => {
    useAssuranceStore.getState().setCapabilities(capabilities);
    expect(useAssuranceStore.getState().available).toBe(true);
    useAssuranceStore.getState().setCapabilities({ ...capabilities, supported: false });
    expect(useAssuranceStore.getState().available).toBe(false);
  });

  it("marks a compiled candidate stale only when semantic identity differs", () => {
    const store = useAssuranceStore.getState();
    store.setCapabilities(capabilities);
    store.enter({ nodes: [], edges: [], historyIndex: 0 });
    store.setCompiled(artifact, "same");
    useAssuranceStore.getState().markStaleAgainst("same");
    expect(useAssuranceStore.getState().status).toBe("compiled");
    useAssuranceStore.getState().markStaleAgainst("different");
    expect(useAssuranceStore.getState().status).toBe("stale");
  });

  it("stales the candidate when graph-level outer revision policy changes", () => {
    const store = useAssuranceStore.getState();
    store.setCapabilities(capabilities);
    store.enter({ nodes: [], edges: [], historyIndex: 0 });
    store.setCompiled(artifact, "same");
    useAssuranceStore.getState().setMaxOuterRevisions(1);
    expect(useAssuranceStore.getState().status).toBe("stale");
  });

  it("treats baseline and assured as separate immutable candidates", () => {
    const store = useAssuranceStore.getState();
    store.setCapabilities(capabilities);
    store.enter({ nodes: [], edges: [], historyIndex: 0 });
    store.setCompiled(artifact, "assured");
    useAssuranceStore.getState().setProfile("baseline");
    expect(useAssuranceStore.getState().profile).toBe("baseline");
    expect(useAssuranceStore.getState().status).toBe("stale");
    expect(useAssuranceStore.getState().run).toBeNull();
  });

  it("keeps or returns the entry snapshot without server graph replacement", () => {
    const store = useAssuranceStore.getState();
    store.setCapabilities(capabilities);
    store.enter({ nodes: [], edges: [], historyIndex: 3 });
    const snapshot = useAssuranceStore.getState().exitRevert();
    expect(snapshot?.historyIndex).toBe(3);
    expect(useAssuranceStore.getState().artifact).toBeNull();
    expect(useAssuranceStore.getState().enabled).toBe(false);
  });
});
