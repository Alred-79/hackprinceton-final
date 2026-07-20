/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowArchitect from "./WorkflowArchitect";
import { ARCHITECT_TEMPLATES } from "@/features/architect/templates";
import { supabase } from "@/integrations/supabase/client";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setTextarea(element: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setInput(element: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(element: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function clickButton(container: ParentNode, label: string, index = 0) {
  const buttons = [...container.querySelectorAll("button")].filter((button) => button.textContent?.trim().includes(label));
  act(() => buttons[index]?.click());
}

function labeledControl<T extends HTMLInputElement | HTMLSelectElement>(container: ParentNode, label: string): T {
  const wrapper = [...container.querySelectorAll("label")].find((item) => item.textContent?.includes(label));
  return wrapper?.querySelector<T>("input, select") as T;
}

describe("Workflow Architect local component journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<MemoryRouter initialEntries={["/architect"]}><WorkflowArchitect /></MemoryRouter>));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows truthful copy and keeps the exact template prompt", () => {
    expect(container.textContent).toContain("Describe a task. Build a local workflow draft.");
    expect(container.textContent).toContain("We'll map recognized steps, disclose ambiguity, and let you edit the draft.");
    expect(container.textContent).not.toMatch(/optimal|optimized|task pass|savings|production-readiness/i);
    clickButton(container, "Live Competitor Intel Feed");
    expect(container.querySelector<HTMLTextAreaElement>("#architect-description")?.value).toBe(ARCHITECT_TEMPLATES[0].prompt);
  });

  it("decomposes all-unmatched text locally and discloses what was not recognized", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setTextarea(container.querySelector("#architect-description")!, "Violet moons hum softly beyond glass");
    clickButton(container, "Decompose");
    expect(container.textContent).toContain("Local workflow draft");
    expect(container.textContent).toContain("Unrecognized simulated step");
    expect(container.textContent).toContain("No actionable capability was recognized");
    expect(container.textContent).toContain("Deterministic local simulation—no external tools are called");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("runs the actual Decompose and Preview controls without any network transport", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const invokeSpy = vi.spyOn(supabase.functions, "invoke");
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const webSocketSpy = vi.fn();
    vi.stubGlobal("WebSocket", webSocketSpy);
    clickButton(container, "Live Competitor Intel Feed");
    clickButton(container, "Decompose");
    clickButton(container, "Run preview");
    clickButton(container, "Pause");
    expect(container.querySelector(".architect-current-transition")?.textContent).toContain("Current transition");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    invokeSpy.mockRestore();
    xhrSpy.mockRestore();
  });

  it("commits the atomic inspector controls and restores focus after add, delete, and rejection", () => {
    clickButton(container, "Live Competitor Intel Feed");
    clickButton(container, "Decompose");
    const inspector = container.querySelector<HTMLElement>(".architect-inspector")!;
    const insertSection = inspector.querySelector<HTMLElement>("#architect-insert-controls")!;
    const insertSelects = insertSection.querySelectorAll("select");
    const insertInput = insertSection.querySelector<HTMLInputElement>("input")!;

    setSelect(insertSelects[1], "evaluator");
    setInput(insertInput, "Temporary component evaluation");
    clickButton(insertSection, "Insert evaluator");
    const inserted = [...inspector.querySelectorAll<HTMLButtonElement>(".architect-item-list button")]
      .find((button) => button.textContent?.includes("Temporary component evaluation"))!;
    expect(document.activeElement).toBe(inserted);
    clickButton(inspector, "Delete linear node");
    const restored = [...inspector.querySelectorAll<HTMLButtonElement>(".architect-item-list button")]
      .find((button) => button.textContent?.includes("Search competitor news"))!;
    expect(document.activeElement).toBe(restored);

    setSelect(insertSelects[1], "router");
    setInput(insertInput, "Edited component router");
    clickButton(insertSection, "Insert router");
    const routerButton = [...inspector.querySelectorAll<HTMLButtonElement>(".architect-item-list button")]
      .find((button) => button.textContent?.includes("Edited component router"))!;
    expect(document.activeElement).toBe(routerButton);
    expect([...inspector.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Router deletion deferred"))?.disabled).toBe(true);

    const firstRoute = inspector.querySelector<HTMLFieldSetElement>(".architect-route-editor")!;
    const routeInputs = firstRoute.querySelectorAll("input");
    setInput(routeInputs[0], "component-route");
    clickButton(firstRoute, "Commit route ID");
    const renamedRoute = inspector.querySelector<HTMLFieldSetElement>(".architect-route-editor")!;
    setInput(renamedRoute.querySelectorAll("input")[1], "Component route label");
    clickButton(renamedRoute, "Commit label");
    clickButton(renamedRoute, "Make named default");
    expect(inspector.querySelector(".architect-route-editor legend")?.textContent).toBe("Default route");

    const rawSection = [...inspector.querySelectorAll<HTMLElement>(".architect-inspector__section")]
      .find((section) => section.querySelector("h4")?.textContent === "Raw connection")!;
    const rawSelects = rawSection.querySelectorAll("select");
    setSelect(rawSelects[0], "action-1");
    setSelect(rawSelects[rawSelects.length - 1], "action-3");
    clickButton(rawSection, "Connect and validate");
    const edgeSelect = insertSection.querySelector<HTMLSelectElement>("select")!;
    const connected = [...edgeSelect.options].find((option) => option.textContent === "action-1 → action-3")!;
    expect(connected).toBeDefined();
    setSelect(edgeSelect, connected.value);
    setSelect(rawSelects[rawSelects.length - 1], "router-1");
    clickButton(rawSection, "Reconnect selected edge to target");
    expect([...edgeSelect.options].map((option) => option.textContent)).toContain("action-1 → router-1");
    clickButton(rawSection, "Disconnect selected edge");
    expect([...edgeSelect.options].map((option) => option.textContent)).not.toContain("action-1 → router-1");

    setSelect(rawSelects[0], "action-1");
    setSelect(rawSelects[rawSelects.length - 1], "action-1");
    clickButton(rawSection, "Connect and validate");
    const rejection = inspector.querySelector<HTMLElement>('[role="alert"]')!;
    expect(rejection.textContent).toContain("Edit rejected");
    expect(document.activeElement).toBe(rejection);
  });

  it("fills policy slots by keyboard fallback, exposes typed configuration, and stales preview", () => {
    setTextarea(container.querySelector("#architect-description")!, "Analyze findings");
    clickButton(container, "Decompose");
    const palette = container.querySelector<HTMLElement>(".architect-palette")!;
    clickButton(palette, "Schema Contract");
    const schemaSlot = container.querySelector<HTMLButtonElement>('[data-compatible-kinds~="schema_gate"]')!;
    expect(schemaSlot.classList.contains("is-selected-compatible")).toBe(true);
    act(() => schemaSlot.click());
    expect(container.textContent).toContain("Schema Contract");

    clickButton(palette, "Context Boundary");
    const contextSlot = container.querySelector<HTMLButtonElement>('[data-compatible-kinds~="context_gate"]')!;
    act(() => contextSlot.click());
    expect(container.textContent).toContain("Context Boundary");
    expect(container.textContent).toContain("Schema contracts");
    expect(container.textContent).toContain("Context boundaries");

    clickButton(container, "Run preview");
    clickButton(container, "Pause");
    const inspector = container.querySelector<HTMLElement>(".architect-inspector")!;
    clickButton(inspector.querySelector(".architect-item-list")!, "Schema Contract");
    const schemaEditor = inspector.querySelector<HTMLElement>('.architect-config-editor[id^="node-config-"]')!;
    setInput(labeledControl<HTMLInputElement>(schemaEditor, "Contract name"), "ComponentContract");
    setSelect(labeledControl<HTMLSelectElement>(schemaEditor, "Unknown fields"), "strip_unknown");
    setInput(labeledControl<HTMLInputElement>(schemaEditor, "Required fields"), "summary, citations");
    setSelect(labeledControl<HTMLSelectElement>(schemaEditor, "On violation"), "review");
    clickButton(schemaEditor, "Commit schema contract");
    expect(container.textContent).toContain("retained events are stale");
    expect(container.querySelector('[data-policy-summary="schema_gate"]')?.textContent).toBe("strip_unknown · 2 fields");

    clickButton(inspector.querySelector(".architect-item-list")!, "Context Boundary");
    const contextEditor = inspector.querySelector<HTMLElement>('.architect-config-editor[id^="node-config-"]')!;
    expect(contextEditor.textContent).toContain("fixture symbolic units");
    setInput(labeledControl<HTMLInputElement>(contextEditor, "Fixture symbolic-unit cap"), "2048");
    setSelect(labeledControl<HTMLSelectElement>(contextEditor, "Boundary strategy"), "summarize");
    setInput(labeledControl<HTMLInputElement>(contextEditor, "Allowed sources"), "workflow input, handbook");
    setInput(labeledControl<HTMLInputElement>(contextEditor, "Blocked fields"), "credentials");
    clickButton(contextEditor, "Commit context boundary");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-policy-summary="context_gate"]')?.textContent).toBe("2,048 symbolic units · summarize");

    const decisionEvidence = container.querySelector(".architect-decision-evidence")!;
    const graphFacts = container.querySelector<HTMLDetailsElement>(".architect-graph-facts")!;
    expect(Boolean(decisionEvidence.compareDocumentPosition(graphFacts) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(graphFacts.open).toBe(false);
    expect(container.textContent).toContain("Configured policy only; this preview does not enforce live schemas or measure tokens.");
  });

  it("shows non-color status before completion and marks retained evidence stale after an edit", () => {
    clickButton(container, "Live Competitor Intel Feed");
    clickButton(container, "Decompose");
    clickButton(container, "Run preview");
    clickButton(container, "Pause");
    expect(container.textContent).toContain("Current transition");
    expect(container.querySelector('[data-node-status-label="Active"]')).not.toBeNull();
    expect(container.querySelector('[data-node-status-label="Skipped"]')).not.toBeNull();

    const label = container.querySelector<HTMLInputElement>('.architect-inspector input[maxlength="180"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(label, "Edited during preview");
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    clickButton(container, "Commit label");
    expect(container.textContent).toContain("retained events are stale");
    expect(container.querySelector(".architect-current-transition")).toBeNull();
  });

  it("keeps dirty edits when destructive replacement is cancelled", () => {
    clickButton(container, "Live Competitor Intel Feed");
    clickButton(container, "Decompose");
    const label = container.querySelector<HTMLInputElement>('.architect-inspector input[maxlength="180"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(label, "Edited schedule input");
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    clickButton(container, "Commit label");
    clickButton(container, "Reset from description");
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("permanently discard your graph edits");
    clickButton(container, "Keep my edits");
    expect(container.textContent).toContain("Edited schedule input");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
