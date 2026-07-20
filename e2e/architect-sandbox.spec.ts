import { expect, test, type Page } from "@playwright/test";

async function chooseMarketTemplate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Live Competitor Intel Feed" }).click();
  await page.getByRole("button", { name: "Decompose" }).click();
  await expect(page.getByRole("heading", { name: "Local workflow draft" })).toBeVisible();
}

async function setDocumentVisibility(page: Page, hidden: boolean) {
  await page.evaluate((nextHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: nextHidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: nextHidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function panCanvasHorizontally(page: Page, deltaX: number) {
  const canvas = await page.locator(".architect-canvas").boundingBox();
  if (!canvas) throw new Error("Expected canvas geometry for pan");
  const startX = canvas.x + canvas.width / 2;
  const startY = canvas.y + canvas.height - 28;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

async function exerciseAtomicEditor(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  const inspector = page.locator(".architect-inspector");

  const flowNodes = page.locator(".react-flow__node");
  const visibleNodeIndex = await flowNodes.evaluateAll((nodes) => {
    const canvas = document.querySelector<HTMLElement>(".architect-canvas")!.getBoundingClientRect();
    return nodes.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom;
    });
  });
  expect(visibleNodeIndex).toBeGreaterThanOrEqual(0);
  const flowNode = flowNodes.nth(visibleNodeIndex);
  const beforeDrag = await flowNode.boundingBox();
  if (!beforeDrag) throw new Error("Expected the input node to have pointer geometry");
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 72, beforeDrag.y + beforeDrag.height / 2 + 36, { steps: 6 });
  await page.mouse.up();
  const afterDrag = await flowNode.boundingBox();
  expect(afterDrag?.x).not.toBe(beforeDrag?.x);

  await inspector.locator(".architect-item-list button").nth(visibleNodeIndex).click();
  const beforeTransform = await flowNode.getAttribute("style");
  await inspector.getByRole("button", { name: "Nudge node right" }).click();
  await expect.poll(() => flowNode.getAttribute("style")).not.toBe(beforeTransform);

  const workflowDetails = inspector.locator("details").filter({ hasText: "Advanced / Workflow blocks" });
  await workflowDetails.locator("summary").click();
  await expect(workflowDetails).toHaveAttribute("open", "");
  const advancedInsert = inspector.locator("#architect-insert-controls");
  await expect(advancedInsert).toHaveCount(1);
  await advancedInsert.scrollIntoViewIfNeeded();
  await advancedInsert.locator("select").nth(1).selectOption("evaluator");
  await advancedInsert.locator("input").fill("Temporary evaluation");
  await advancedInsert.getByRole("button", { name: "Insert evaluator" }).click();
  await expect(page.getByRole("button", { name: "Temporary evaluation evaluator" })).toBeFocused();
  await inspector.getByRole("button", { name: "Delete linear node" }).click();
  await expect(page.getByRole("button", { name: "Search competitor news action" })).toBeFocused();

  await advancedInsert.locator("select").nth(1).selectOption("router");
  await advancedInsert.locator("input").fill("Edited binary router");
  await advancedInsert.getByRole("button", { name: "Insert router" }).click();
  await expect(page.getByRole("button", { name: "Edited binary router router" })).toBeFocused();
  await expect(inspector.getByRole("button", { name: "Router deletion deferred" })).toBeDisabled();
  const advancedWiring = inspector.locator("details").filter({ hasText: "Advanced wiring" });
  await advancedWiring.locator("summary").click();
  await expect(advancedWiring).toHaveAttribute("open", "");
  const firstRoute = advancedWiring.locator("fieldset.architect-route-editor").first();
  const routeId = `edited-route-${width}`;
  await firstRoute.getByLabel("Route ID").fill(routeId);
  await firstRoute.getByRole("button", { name: "Commit route ID" }).click();
  await expect(firstRoute.getByLabel("Route ID")).toHaveValue(routeId);
  await firstRoute.getByLabel("Display label").fill("Edited route label");
  await firstRoute.getByRole("button", { name: "Commit label" }).click();
  await expect(firstRoute.getByLabel("Display label")).toHaveValue("Edited route label");
  await firstRoute.getByRole("button", { name: "Make named default" }).click();
  await expect(firstRoute.locator("legend")).toHaveText("Default route");
  await expect(page.locator(`.react-flow__handle[data-handleid="${routeId}"]`)).toHaveCount(1);

  const rawConnection = advancedWiring.locator("section.architect-inspector__section").last();
  const source = rawConnection.locator("select").first();
  const target = rawConnection.locator("select").last();
  await source.selectOption({ label: "Search competitor news" });
  await target.selectOption({ label: "Read lost deals from Postgres CRM" });
  await advancedWiring.getByRole("button", { name: "Connect and validate" }).click();
  const edgeSelect = inspector.locator("#architect-insert-controls select").first();
  await expect.poll(() => edgeSelect.locator("option").allTextContents()).toContain("action-1 → action-3");
  await edgeSelect.selectOption({ label: "action-1 → action-3" });
  await target.selectOption({ label: "Anything flagged?" });
  await advancedWiring.getByRole("button", { name: "Reconnect selected edge to target" }).click();
  await expect.poll(() => edgeSelect.locator("option").allTextContents()).toContain("action-1 → router-1");
  await advancedWiring.getByRole("button", { name: "Disconnect selected edge" }).click();
  await expect.poll(() => edgeSelect.locator("option").allTextContents()).not.toContain("action-1 → router-1");

  await expect(page.getByText("dirty", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("Decompose and Run preview make zero requests after page load", async ({ page }) => {
  await page.goto("/architect");
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await chooseMarketTemplate(page);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Run preview" }).click();
  await expect(page.getByText(/Preview transition 1 running|Preview complete/)).toBeAttached();
  expect(requests).toEqual([]);
  await expect(page.getByText("Deterministic local simulation—no external tools are called")).toBeVisible();
});

test("keyboard editor commits an atomic insert and rejects an invalid raw connection", async ({ page }) => {
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  const inspector = page.locator(".architect-inspector");
  const workflowDetails = inspector.locator("details").filter({ hasText: "Advanced / Workflow blocks" });
  await workflowDetails.locator("summary").click();
  await expect(workflowDetails).toHaveAttribute("open", "");
  const advancedInsert = inspector.locator("#architect-insert-controls");
  await expect(advancedInsert).toHaveCount(1);
  await advancedInsert.scrollIntoViewIfNeeded();
  await advancedInsert.locator("select").nth(1).selectOption("evaluator");
  await advancedInsert.locator("input").fill("Keyboard evaluation");
  await advancedInsert.getByRole("button", { name: "Insert evaluator" }).click();
  await expect(page.getByRole("button", { name: /Keyboard evaluation evaluator/ })).toBeFocused();
  await expect(page.getByText("dirty", { exact: true })).toBeVisible();

  const wiring = inspector.locator("details").filter({ hasText: "Advanced wiring" });
  await wiring.locator("summary").click();
  await expect(wiring).toHaveAttribute("open", "");
  const rawConnection = wiring.locator("section.architect-inspector__section").last();
  const source = rawConnection.locator("select").first();
  const target = rawConnection.locator("select").last();
  const sourceValue = await source.locator("option").nth(1).getAttribute("value");
  await source.selectOption(sourceValue!);
  await target.selectOption(sourceValue!);
  await wiring.getByRole("button", { name: "Connect and validate" }).click();
  await expect(page.getByRole("alert")).toContainText("Edit rejected");
  await expect(page.getByRole("alert")).toBeFocused();
});

test("dirty replacement requires an explicit named confirmation", async ({ page }) => {
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  await page.getByLabel("Display label").first().fill("Edited schedule input");
  await page.getByRole("button", { name: "Commit label" }).first().click();
  await page.getByRole("button", { name: "Reset from description" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("permanently discard your graph edits");
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await expect(page.getByRole("button", { name: "Edited schedule input input" })).toBeVisible();
  await page.getByRole("button", { name: "Reset from description" }).click();
  await page.getByRole("button", { name: "Discard edits and rebuild" }).click();
  await expect(page.getByRole("button", { name: "Schedule input input" })).toBeVisible();
});

for (const width of [1440, 1024]) {
  test(`${width}px market template stays readable and accepts an exact-edge policy drag`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/architect");
    await chooseMarketTemplate(page);
    await expect(page.locator(".react-flow__node")).toHaveCount(10);
    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!;
      const canvas = document.querySelector<HTMLElement>(".architect-canvas")!.getBoundingClientRect();
      const slots = [...document.querySelectorAll<HTMLButtonElement>(".architect-policy-slot")];
      const nodes = [...document.querySelectorAll<HTMLElement>(".architect-node")];
      const scale = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
      const intersects = (a: DOMRect, b: DOMRect) => (
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      );
      return {
        scale,
        slotCount: slots.length,
        slots: slots.map((slot, index) => {
          const rect = slot.getBoundingClientRect();
          return {
            index,
            width: rect.width,
            height: rect.height,
            edgeId: slot.dataset.edgeId ?? "",
            compatibleKinds: slot.dataset.compatibleKinds ?? "",
            intersectsNode: nodes.some((node) => intersects(rect, node.getBoundingClientRect())),
            fullyVisible: rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom,
          };
        }),
      };
    });
    expect(geometry.scale).toBeGreaterThanOrEqual(0.69);
    expect(geometry.slotCount).toBeGreaterThan(0);
    expect(geometry.slotCount).toBeLessThanOrEqual(6);
    for (const slot of geometry.slots) {
      expect(Math.min(slot.width, slot.height)).toBeGreaterThanOrEqual(24);
      expect(slot.intersectsNode).toBe(false);
    }
    const visible = geometry.slots.find((slot) => slot.fullyVisible);
    expect(visible).toBeDefined();
    const kind = visible!.compatibleKinds.split(" ")[0];
    const card = page.locator(`[data-policy-kind="${kind}"]`);
    const slot = page.locator(".architect-policy-slot").nth(visible!.index);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    await expect(slot).toHaveClass(/is-compatible/);
    await expect(page.locator(".architect-policy-slot.is-incompatible").first()).toHaveAttribute("aria-disabled", "true");
    await slot.dispatchEvent("dragover", { dataTransfer });
    await slot.dispatchEvent("drop", { dataTransfer });
    await card.dispatchEvent("dragend", { dataTransfer });
    await expect(page.locator(`.architect-policy-slot[data-edge-id="${visible!.edgeId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-policy-summary="${kind}"]`)).toHaveCount(1);
  });
}

test("keyboard selection activates a compatible review slot", async ({ page }) => {
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  const reviewCard = page.locator('[data-policy-kind="human_review"]');
  await reviewCard.focus();
  await reviewCard.press("Enter");
  await expect(reviewCard).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".architect-policy-slot.is-compatible").first()).toBeVisible();
  const incompatible = page.locator(".architect-policy-slot.is-incompatible").first();
  await expect(incompatible).toBeVisible();
  await expect(incompatible).toHaveAttribute("aria-disabled", "true");
  const slot = page.locator('[data-policy-slot-fallback]').first();
  await slot.focus();
  await slot.press("Enter");
  await expect(page.getByRole("button", { name: "Human Review human review" })).toBeFocused();
  await expect(page.getByText("Human reviews").locator("..").getByText("1", { exact: true })).toBeVisible();
});

test("configured policy preview uses symbolic evidence only", async ({ page }) => {
  await page.goto("/architect");
  await page.getByRole("textbox", { name: "Describe your task" }).fill("Analyze findings");
  await page.getByRole("button", { name: "Decompose" }).click();
  await page.locator('[data-policy-kind="schema_gate"]').click();
  await page.locator('[data-policy-slot-fallback]').first().click();
  await page.locator('[data-policy-kind="context_gate"]').click();
  await page.locator('[data-policy-slot-fallback]').first().click();

  await page.getByRole("button", { name: "Schema Contract schema gate" }).click();
  const inspector = page.locator(".architect-inspector");
  await inspector.getByLabel("Contract name").fill("BrowserContract");
  await inspector.getByLabel("Unknown fields").selectOption("strip_unknown");
  await inspector.getByLabel("Required fields").fill("summary, citations");
  await inspector.getByLabel("On violation").selectOption("review");
  await inspector.getByRole("button", { name: "Commit schema contract" }).click();
  await expect(page.locator('[data-policy-summary="schema_gate"]')).toHaveText("strip_unknown · 2 fields");
  await page.getByRole("button", { name: "Context Boundary context gate" }).click();
  await inspector.getByLabel("Fixture symbolic-unit cap").fill("2048");
  await inspector.getByLabel("Boundary strategy").selectOption("summarize");
  await inspector.getByRole("button", { name: "Commit context boundary" }).click();
  await expect(page.locator('[data-policy-summary="context_gate"]')).toHaveText("2,048 symbolic units · summarize");
  const hierarchy = await page.evaluate(() => {
    const decision = document.querySelector(".architect-decision-evidence")!;
    const graphFacts = document.querySelector<HTMLDetailsElement>(".architect-graph-facts")!;
    const policyNode = document.querySelector<HTMLElement>('.architect-node:has([data-policy-summary="schema_gate"])')!;
    const automationNode = document.querySelector<HTMLElement>('.architect-node[data-decision-node="false"]')!;
    const rgbTotal = (value: string) => (value.match(/\d+/g) ?? []).slice(0, 3).reduce((total, part) => total + Number(part), 0);
    return {
      decisionBeforeFacts: Boolean(decision.compareDocumentPosition(graphFacts) & Node.DOCUMENT_POSITION_FOLLOWING),
      graphFactsOpen: graphFacts.open,
      policyBackground: rgbTotal(getComputedStyle(policyNode).backgroundColor),
      automationBackground: rgbTotal(getComputedStyle(automationNode).backgroundColor),
    };
  });
  expect(hierarchy.decisionBeforeFacts).toBe(true);
  expect(hierarchy.graphFactsOpen).toBe(false);
  expect(hierarchy.policyBackground).toBeGreaterThan(hierarchy.automationBackground);
  await expect(page.getByText("Configured policy only; this preview does not enforce live schemas or measure tokens.")).toBeVisible();
  await page.getByRole("button", { name: "Run preview" }).click();
  await expect(page.getByText(/Context Boundary: Context boundary configured/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Schema Contract: Schema contract configured \(BrowserContract, strip_unknown\); symbolic only—no live schema validation/)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".architect-timeline__list").getByText(/fixture symbolic units/)).toBeVisible();
  await expect(page.getByText(/Pydantic executed|measured \d+ tokens/i)).toHaveCount(0);
});

for (const width of [1440, 1024]) {
  test(`${width}px editor runs the complete atomic keyboard/pointer matrix`, async ({ page }) => {
    await exerciseAtomicEditor(page, width);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      canvas: document.querySelector(".architect-canvas")?.getBoundingClientRect().width ?? 0,
      inspector: document.querySelector(".architect-inspector")?.getBoundingClientRect().width ?? 0,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.canvas).toBeGreaterThan(400);
    expect(dimensions.inspector).toBeGreaterThan(250);
  });
}

test("React Flow pointer connect and pointer edge selection use the committed graph", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  const edgeCount = await page.locator(".react-flow__edge").count();
  const sourceHandle = page.locator('.react-flow__node[data-id="action-1"] .react-flow__handle.source');
  const targetHandle = page.locator('.react-flow__node[data-id="action-3"] .react-flow__handle.target');
  await panCanvasHorizontally(page, 280);
  await expect(sourceHandle).toBeInViewport();
  await expect(targetHandle).toBeInViewport();
  await sourceHandle.dragTo(targetHandle);
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount + 1);
  const added = page.locator(".react-flow__edge").last();
  const addedId = await added.getAttribute("data-id") ?? "";
  const clickPoint = await added.locator(".react-flow__edge-interaction").evaluate((path) => {
    const svgPath = path as SVGPathElement;
    const point = svgPath.getPointAtLength(svgPath.getTotalLength() * 0.08);
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(svgPath.getScreenCTM()!);
    return { x: screenPoint.x, y: screenPoint.y };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  const edgeSelect = page.locator("#architect-insert-controls select").first();
  await expect(edgeSelect).toHaveValue(addedId);
  const inspector = page.locator(".architect-inspector");
  const wiring = inspector.locator("details").filter({ hasText: "Advanced wiring" });
  await wiring.locator("summary").click();
  await expect(wiring).toHaveAttribute("open", "");
  await wiring.getByRole("button", { name: "Disconnect selected edge" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount);
});

test("390px layout has no horizontal overflow and keeps controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    canvasHeight: document.querySelector(".architect-canvas")?.getBoundingClientRect().height ?? 0,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.canvasHeight).toBeGreaterThanOrEqual(420);
  const workflowDetails = page.locator(".architect-inspector details").filter({ hasText: "Advanced / Workflow blocks" });
  await expect(workflowDetails.locator("summary")).toBeVisible();
  await workflowDetails.locator("summary").click();
  await expect(workflowDetails).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Insert action" })).toBeVisible();
  await page.locator('[data-policy-kind="context_gate"]').click();
  await expect(page.locator('[data-policy-slot-fallback]').first()).toBeVisible();
  await page.locator('[data-policy-slot-fallback]').first().click();
  await expect(page.getByRole("button", { name: "Context Boundary context gate" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("heading", { name: "Preview timeline" })).toBeVisible();
});

test.describe("touch policy fallback", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("uses a real touch context and tap activation", async ({ page }) => {
    await page.goto("/architect");
    await chooseMarketTemplate(page);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    await page.locator('[data-policy-kind="context_gate"]').tap();
    const fallback = page.locator("[data-policy-slot-fallback]").first();
    await expect(fallback).toBeVisible();
    await fallback.tap();
    await expect(page.getByRole("button", { name: "Context Boundary context gate" })).toBeFocused();
  });
});

test("node capacity exposes full unresolved evidence without actionable policy slots", async ({ page }) => {
  await page.goto("/architect");
  const prompt = Array.from({ length: 24 }, (_, index) => `analyze finding ${index + 1}`).join(" then ");
  await page.getByRole("textbox", { name: "Describe your task" }).fill(prompt);
  await page.getByRole("button", { name: "Decompose" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(15);
  const slots = page.locator(".architect-policy-slot");
  const renderedCount = await slots.count();
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThanOrEqual(6);
  for (let index = 0; index < renderedCount; index += 1) {
    await expect(slots.nth(index)).toBeDisabled();
    await expect(slots.nth(index)).toHaveAccessibleName(/Unavailable policy slot.*Draft capacity reached/i);
  }
  await expect(page.locator("[data-policy-kind]:not(:disabled)")).toHaveCount(0);
  const unresolved = Number(await page.getByText("Unresolved policy choices").locator("..").locator("dd").textContent());
  expect(unresolved).toBeGreaterThan(6);
  expect(unresolved).toBeGreaterThan(renderedCount);
  await expect(page.locator("[data-policy-slot-fallback]")).toHaveCount(0);
});

test("parallel preview exposes every active edge but renders at most four stable dots", async ({ page }) => {
  await page.goto("/architect");
  await page.getByRole("textbox", { name: "Describe your task" }).fill(
    "Search the web and query the database and call an API and write a file and execute code and notify the team simultaneously then draft a report",
  );
  await page.getByRole("button", { name: "Decompose" }).click();
  const idleEdge = page.locator(".react-flow__edge").first();
  const idlePath = idleEdge.locator(".react-flow__edge-path");
  expect(await idlePath.evaluate((path) => getComputedStyle(path).filter)).toBe("none");
  expect(await idlePath.evaluate((path) => getComputedStyle(path).strokeWidth)).toBe("2px");
  await idleEdge.hover({ force: true });
  expect(await idlePath.evaluate((path) => getComputedStyle(path).filter)).toBe("none");
  expect(await idlePath.evaluate((path) => getComputedStyle(path).strokeWidth)).toBe("2px");
  const firstNodeCard = page.locator(".architect-node").first();
  await firstNodeCard.hover({ force: true });
  expect(await firstNodeCard.evaluate((node) => getComputedStyle(node).filter)).toBe("none");

  await page.getByRole("button", { name: "Run preview" }).click();
  await page.waitForTimeout(260);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("paused", { exact: true })).toBeVisible();
  await expect(page.getByText("Current transition", { exact: true })).toBeVisible();
  await expect(page.locator(".architect-timeline__list li").first()).toBeVisible();
  expect(await page.locator(".architect-current-transition").evaluate((current) => {
    const firstEvent = document.querySelector(".architect-timeline__list li");
    return Boolean(firstEvent && current.compareDocumentPosition(firstEvent) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect.poll(() => page.locator('.architect-edge[data-status="active"]').count()).toBeGreaterThan(0);
  const active = await page.locator('.architect-edge[data-status="active"]').count();
  const dots = await page.locator(".architect-edge__motion-dot").count();
  expect(active).toBeGreaterThanOrEqual(5);
  expect(dots).toBe(4);
  const activeEdges = await page.locator('.architect-edge[data-status="active"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-edge-id")!).sort());
  const dotEdges = await page.locator(".architect-edge:has(.architect-edge__motion-dot)").evaluateAll((items) => items.map((item) => item.getAttribute("data-edge-id")!).sort());
  expect(dotEdges).toEqual(activeEdges.slice(0, 4));
  const activeGroup = page.locator(".architect-edge:has(.architect-edge__motion-dot)").first();
  const activeEdgeId = await activeGroup.getAttribute("data-edge-id");
  const originalActiveGroup = page.locator(`.architect-edge[data-edge-id="${activeEdgeId}"]`);
  const geometry = await activeGroup.evaluate((group) => {
    const path = group.querySelector<SVGPathElement>(".react-flow__edge-path")!;
    const dot = group.querySelector<SVGCircleElement>(".architect-edge__motion-dot")!;
    const progress = Number(dot.getAttribute("data-progress"));
    const expected = path.getPointAtLength(path.getTotalLength() * progress);
    const actual = { x: Number(dot.getAttribute("cx")), y: Number(dot.getAttribute("cy")) };
    return { progress, distance: Math.hypot(expected.x - actual.x, expected.y - actual.y) };
  });
  expect(geometry.progress).toBeGreaterThan(0.15);
  expect(geometry.distance).toBeLessThan(1.5);
  await expect(activeGroup.locator(".architect-edge__status")).toHaveAttribute("data-edge-status-label", "Active");
  expect(await activeGroup.locator(".react-flow__edge-path").evaluate((path) => getComputedStyle(path).filter)).toBe("none");

  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(120);
  await setDocumentVisibility(page, true);
  await expect(page.getByText("paused", { exact: true })).toBeVisible();
  const hiddenProgress = Number(await activeGroup.locator(".architect-edge__motion-dot").getAttribute("data-progress"));
  expect(hiddenProgress).toBeGreaterThan(geometry.progress);
  await page.waitForTimeout(180);
  expect(Number(await activeGroup.locator(".architect-edge__motion-dot").getAttribute("data-progress"))).toBe(hiddenProgress);
  await setDocumentVisibility(page, false);
  await expect(page.getByText("running", { exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  await setDocumentVisibility(page, true);
  const resumedProgress = Number(await activeGroup.locator(".architect-edge__motion-dot").getAttribute("data-progress"));
  const circularProgressDelta = (resumedProgress - hiddenProgress + 1) % 1;
  expect(circularProgressDelta).toBeGreaterThan(0.02);
  expect(circularProgressDelta).toBeLessThan(0.5);
  await setDocumentVisibility(page, false);
  await expect(originalActiveGroup).toHaveAttribute("data-status", "traversed");
  await expect(originalActiveGroup.locator(".architect-edge__status")).toHaveAttribute("data-edge-status-label", "Traversed");
  expect(await originalActiveGroup.locator(".react-flow__edge-path").evaluate((path) => getComputedStyle(path).filter)).toBe("none");
});

test("reduced motion mounts no moving dot", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/architect");
  await chooseMarketTemplate(page);
  await page.getByRole("button", { name: "Run preview" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".architect-edge__motion-dot")).toHaveCount(0);
  await expect(page.getByText("Current transition", { exact: true })).toBeVisible();
  await expect(page.locator('[data-node-status-label="Active"]')).not.toHaveCount(0);
  await expect(page.locator('[data-node-status-label="Skipped"]')).not.toHaveCount(0);
  await expect(page.locator('[data-edge-status-label="Active"]')).not.toHaveCount(0);
});

test("app and simulator routes remain available", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  await page.route("http://localhost:8000/api/capabilities", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      executable_scenarios: ["threat-analyst"],
      design_only_scenarios: [],
      contracts: [],
      guarantees: [],
      operations: [],
      limitations: [],
      scenario_runtimes: [],
    }),
  }));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Leetcode for Agentic AI" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixer Scenarios" })).toBeVisible();
  await page.goto("/simulator/threat-analyst");
  await expect(page.getByRole("heading", { name: "The Threat Analyst", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Problem Statement" })).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(message))).toEqual([]);
});
