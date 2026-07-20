/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BindingGraphPatchDialog,
  type BindingEdgeRow,
  type BindingNodeRow,
} from "./BindingGraphPatchDialog";

const operationLabels = [
  "OSINT MCP",
  "Feed MCP",
  "Intel MCP",
  "Threat Enricher",
  "IOC Correlator",
  "Sandbox MCP",
  "Threat Analyst",
  "Alert MCP",
  "Brief Writer",
];

const initialNodes: BindingNodeRow[] = operationLabels.map((label, index) => ({
  id: `node-${index + 1}`,
  label,
  value: "",
  operations: [
    { value: `operation-${index + 1}-a@1.0.0`, label: `Primary ${label} · v1.0.0` },
    { value: `operation-${index + 1}-b@1.0.0`, label: `Alternate ${label} · v1.0.0` },
  ],
}));

const initialEdges: BindingEdgeRow[] = operationLabels.slice(0, -1).map((_, index) => ({
  id: `edge-${index + 1}`,
  source: `node-${index + 1}`,
  target: `node-${index + 2}`,
  sourcePorts: ["success", "failure"],
  targetPorts: ["in"],
  sourceHandle: "",
  targetHandle: "",
  hadSourceHandle: false,
  hadTargetHandle: false,
}));

function Harness({ onApply }: { onApply: () => void }) {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  return (
    <BindingGraphPatchDialog
      baseHash={"a".repeat(64)}
      nodes={nodes}
      edges={edges}
      onOperationChange={(nodeId, value) =>
        setNodes((current) =>
          current.map((node) => (node.id === nodeId ? { ...node, value } : node)),
        )
      }
      onEdgeHandleChange={(edgeId, direction, value) =>
        setEdges((current) =>
          current.map((edge) =>
            edge.id === edgeId
              ? {
                  ...edge,
                  [direction === "source" ? "sourceHandle" : "targetHandle"]: value,
                }
              : edge,
          ),
        )
      }
      onCancel={() => undefined}
      onApply={onApply}
    />
  );
}

function changeSelect(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("BindingGraphPatchDialog interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onApply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onApply = vi.fn();
    act(() => root.render(<Harness onApply={onApply} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects operations sequentially and opens each subsequent selector without a ref loop", () => {
    const osint = container.querySelector<HTMLSelectElement>(
      '[aria-label="OSINT MCP operation"]',
    );
    const feed = container.querySelector<HTMLSelectElement>(
      '[aria-label="Feed MCP operation"]',
    );
    const intel = container.querySelector<HTMLSelectElement>(
      '[aria-label="Intel MCP operation"]',
    );
    expect(osint).not.toBeNull();
    expect(feed).not.toBeNull();
    expect(intel).not.toBeNull();

    changeSelect(osint!, "operation-1-a@1.0.0");
    act(() => {
      feed!.focus();
      feed!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    changeSelect(feed!, "operation-2-b@1.0.0");
    act(() => {
      intel!.focus();
      intel!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(osint!.value).toBe("operation-1-a@1.0.0");
    expect(feed!.value).toBe("operation-2-b@1.0.0");
    expect(document.activeElement).toBe(intel);
  });

  it("completes all nine operation bindings and every edge handle choice", () => {
    for (let index = 0; index < operationLabels.length; index += 1) {
      const select = container.querySelector<HTMLSelectElement>(
        `[aria-label="${operationLabels[index]} operation"]`,
      );
      expect(select).not.toBeNull();
      changeSelect(select!, `operation-${index + 1}-a@1.0.0`);
    }

    for (let index = 0; index < initialEdges.length; index += 1) {
      const edgeId = `edge-${index + 1}`;
      const source = container.querySelector<HTMLSelectElement>(
        `[aria-label="${edgeId} source handle"]`,
      );
      const target = container.querySelector<HTMLSelectElement>(
        `[aria-label="${edgeId} target handle"]`,
      );
      expect(source).not.toBeNull();
      expect(target).not.toBeNull();
      changeSelect(source!, "success");
      changeSelect(target!, "in");
    }

    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply binding patch",
    );
    expect(apply).toBeDefined();
    expect(apply!.disabled).toBe(false);
    act(() => apply!.click());
    expect(onApply).toHaveBeenCalledOnce();
  });
});
