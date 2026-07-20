import { describe, expect, it, vi } from "vitest";
import { buildFallbackGraph, compileDescription } from "./compiler";
import { canonicalArchitectJson, cloneGraph, constraintMapEvidence, structuralEvidence, validateArchitectGraph } from "./graph";
import {
  derivePolicySlots,
  isReviewableSideEffect,
  POLICY_SLOT_LIMIT,
  selectPolicySlotsForPresentation,
} from "./policySlots";
import { ARCHITECT_TEMPLATES } from "./templates";
import {
  evaluateRouter,
  planPreview,
  PREVIEW_TRANSITION_MS,
  startPreviewTransitionDriver,
  subscribePreviewVisibility,
  type PreviewAnimationScheduler,
} from "./preview";
import {
  architectReducer,
  createArchitectState,
  deleteLinearNode,
  initializeEditorCounters,
  insertNodeOnEdge,
  insertPolicyNodeOnEdge,
  insertRouterOnEdge,
  reconnectEdge,
  renameRouteId,
  swapDefaultRoute,
  updateNodeConfig,
} from "./architectReducer";
import type { ArchitectGraph, RouterConfig } from "./types";

const exactPrompts = [
  "My company [YOUR_COMPANY] sells [YOUR_PRODUCT]. Every morning: stream the latest news about our top 3 competitors from the web, hit their pricing APIs to detect changes, cross-reference with our Postgres CRM for deals we lost last month, run sentiment analysis on anything flagged, and push a [bullet-point Slack digest / full PDF brief] before 9am. If a competitor drops pricing by more than 10%, page the sales lead immediately and skip the digest.",
  "I'm an engineer at [YOUR_COMPANY]. When a Sentry alert fires for our [YOUR_SERVICE] service: fetch the stack trace, search our GitHub repo for the relevant files, query Postgres for impacted users in the last hour, check our internal Confluence knowledge base for prior incidents, then draft a [Slack war-room message / full PagerDuty incident report] with a root-cause hypothesis and a suggested fix. Only page on-call if affected users > [YOUR_THRESHOLD].",
  "We publish [research papers / podcast transcripts / YouTube videos] about [YOUR_TOPIC]. When a new piece drops: search the web for trending discussions on this topic, pull our past content from the knowledge base for brand consistency, write [3 tweets + a LinkedIn post / a newsletter section / all of the above], fact-check any statistics against live sources, run it through a brand voice evaluator, and only publish if confidence score > 85%. Flag anything that contradicts what we said last quarter.",
  "We run an e-commerce platform for [YOUR_INDUSTRY]. Orders stream from Kafka at ~[YOUR_VOLUME] per minute. For each order: validate payment via our billing API, check real-time inventory in our warehouse DB, route [orders over $500 / all orders] through fraud scoring, apply [loyalty tier / promo code / geo-based] discount logic, execute the inventory reservation as a DB transaction, write the confirmed order back, and emit a fulfillment event — all under 2 seconds. Dead-letter anything that fails validation.",
  "I work in [VC / BD / product strategy] at [YOUR_FIRM]. Given a company name: search the web for recent funding rounds and press, scrape their job board to infer engineering priorities, pull SEC filings if they're public, check our internal deal notes database for prior contact, run a SWOT synthesis with citations, iterate the report once if web coverage feels thin, and output a [1-page tearsheet / full investment memo] — [include / exclude] a comparable comps table. Flag anything that looks like they're pivoting.",
];

const expectedLabels: Record<string, string[]> = {
  "market-intel": ["Schedule input", "Search competitor news", "Inspect pricing APIs", "Read lost deals from Postgres CRM", "Anything flagged?", "Analyze flagged sentiment", "Price drop greater than 10%?", "Page sales lead", "Build requested digest", "Delivery output"],
  "bug-triage": ["Sentry alert input", "Read stack trace", "Search GitHub repository", "Query impacted users in Postgres", "Read prior incidents from Confluence", "Draft incident report", "Affected users above threshold?", "Page on-call", "Record no-page outcome", "Incident report output"],
  "content-repurposer": ["New content input", "Search trending discussions", "Retrieve past content", "Compose requested formats", "Fact-check statistics", "Evaluate brand voice", "Check last-quarter contradictions", "Confidence score above 85%?", "Publish content", "Flag for human review", "Publication decision output"],
  "order-pipeline": ["Order stream input", "Evaluate payment validity", "Payment valid?", "Read real-time warehouse inventory", "Write dead-letter outcome", "Order matches fraud-scoring choice?", "Evaluate fraud score", "Apply requested discount logic", "Write inventory reservation transaction", "Write confirmed order", "Emit fulfillment event", "Order processing output"],
  "due-diligence": ["Company name input", "Search funding rounds and press", "Inspect company job board", "Retrieve public filings", "Read internal deal notes", "Compose SWOT synthesis", "Web coverage feels thin?", "Revise report once", "Build requested report", "Deal research output"],
};

const expectedActionKinds: Record<string, string[]> = {
  "market-intel": ["web_search", "api_call", "knowledge_retrieval", "reasoning", "notification", "file_operation"],
  "bug-triage": ["file_operation", "file_operation", "knowledge_retrieval", "knowledge_retrieval", "reasoning", "notification", "notification"],
  "content-repurposer": ["web_search", "knowledge_retrieval", "reasoning", "web_search", "knowledge_retrieval", "notification"],
  "order-pipeline": ["knowledge_retrieval", "file_operation", "reasoning", "file_operation", "file_operation", "notification"],
  "due-diligence": ["web_search", "web_search", "knowledge_retrieval", "knowledge_retrieval", "reasoning", "reasoning", "file_operation"],
};

const expectedNoteKinds: Record<string, string[]> = {
  "market-intel": ["placeholder"],
  "bug-triage": ["placeholder", "placeholder"],
  "content-repurposer": ["placeholder"],
  "order-pipeline": ["placeholder", "placeholder"],
  "due-diligence": ["placeholder", "ambiguous"],
};

const expectedJoinLabels: Record<string, string[]> = {
  "market-intel": ["Price drop greater than 10%?", "Delivery output"],
  "bug-triage": ["Incident report output"],
  "content-repurposer": ["Publication decision output"],
  "order-pipeline": ["Apply requested discount logic", "Order processing output"],
  "due-diligence": ["Build requested report"],
};

describe("architect local compiler", () => {
  it("keeps all five template prompts byte-for-byte stable", () => {
    expect(ARCHITECT_TEMPLATES.map((template) => template.prompt)).toEqual(exactPrompts);
  });

  for (const template of ARCHITECT_TEMPLATES) {
    it(`compiles the ${template.id} salient topology offline`, () => {
      const graph = compileDescription(template.prompt);
      expect(graph.origin).toBe("local");
      expect(validateArchitectGraph(graph)).toEqual({ valid: true, errors: [] });
      expect(graph.nodes.length).toBeLessThanOrEqual(15);
      expect(graph.nodes.some((node) => node.kind === "schema_gate" || node.kind === "context_gate")).toBe(false);
      expect(graph.nodes.map((node) => node.label)).toEqual(expectedLabels[template.id]);
      expect(graph.nodes.filter((node) => node.config.type === "action").map((node) => node.config.type === "action" ? node.config.actionKind : ""))
        .toEqual(expectedActionKinds[template.id]);
      expect(graph.extractionNotes.map((note) => note.kind)).toEqual(expectedNoteKinds[template.id]);
      expect(graph.nodes.filter((node) => graph.edges.filter((edge) => edge.target === node.id).length > 1).map((node) => node.label))
        .toEqual(expectedJoinLabels[template.id]);
      for (const router of graph.nodes.filter((node) => node.config.type === "router")) {
        if (router.config.type !== "router") continue;
        expect(router.config.routes).toHaveLength(2);
        expect(router.config.routes.map((route) => route.role).sort()).toEqual(["condition", "default"]);
        expect(graph.edges.filter((edge) => edge.source === router.id).map((edge) => edge.sourceHandle).sort())
          .toEqual(router.config.routes.map((route) => route.id).sort());
      }
      const lower = JSON.stringify(graph).toLowerCase();
      for (const vendor of ["salesforce", "openai", "aws", "stripe", "mongodb", "twilio"]) {
        if (!template.prompt.toLowerCase().includes(vendor)) expect(lower).not.toContain(vendor);
      }
    });
  }

  it("keeps plain conjunctions sequential and explicit work parallel", () => {
    const sequential = compileDescription("Search the web and query the database then draft a report");
    const parallel = compileDescription("Search the web and query the database in parallel, then draft a report");
    expect(structuralEvidence(sequential).maximumExplicitParallelWidth).toBe(1);
    expect(structuralEvidence(parallel).maximumExplicitParallelWidth).toBe(2);
    const draft = parallel.nodes.find((node) => /draft/i.test(node.label))!;
    expect(parallel.edges.filter((edge) => edge.target === draft.id)).toHaveLength(2);
  });

  it("preserves protected commas and discloses each unmatched segment with exact normalized offsets", () => {
    const description = "  Search   the web and teleport the result; Write [tweet, newsletter]; Write \"alpha, beta\"  ";
    const normalized = description.slice(0, 8_000).trim().replace(/\s+/g, " ");
    const graph = compileDescription(description);
    expect(graph.nodes.some((node) => node.label === "Search the web")).toBe(true);
    expect(graph.nodes.some((node) => node.label === "Write [tweet, newsletter]")).toBe(true);
    expect(graph.nodes.some((node) => node.label === 'Write "alpha, beta"')).toBe(true);
    const unmatched = graph.extractionNotes.find((note) => note.kind === "unmatched" && note.message.includes("teleport the result"));
    expect(unmatched).toBeDefined();
    expect(normalized.slice(unmatched!.sourceStart, unmatched!.sourceEnd)).toBe("teleport the result");
  });

  it("keeps explicit conditional work parallel and joins both branches before downstream work", () => {
    const graph = compileDescription("If enabled, notify alpha and notify beta in parallel, then write a report");
    expect(graph.origin).toBe("local");
    expect(validateArchitectGraph(graph).valid).toBe(true);
    const router = graph.nodes.find((node) => node.config.type === "router")!;
    const fork = graph.nodes.find((node) => node.label === "Explicit parallel fork")!;
    const notifications = graph.nodes.filter((node) => node.config.type === "action" && /notify (alpha|beta)/i.test(node.label));
    const report = graph.nodes.find((node) => /write a report/i.test(node.label))!;
    const config = router.config as RouterConfig;
    expect(graph.edges.find((edge) => edge.source === router.id && edge.sourceHandle === config.conditionRouteId)?.target).toBe(fork.id);
    expect(graph.edges.filter((edge) => edge.source === fork.id).map((edge) => edge.target).sort())
      .toEqual(notifications.map((node) => node.id).sort());
    expect(graph.edges.filter((edge) => edge.target === report.id).map((edge) => edge.source).sort())
      .toEqual([...notifications.map((node) => node.id), router.id].sort());
    expect(structuralEvidence(graph).maximumExplicitParallelWidth).toBe(2);

    const conditionPlan = planPreview(graph, { booleanFlag: true });
    const notificationTransition = conditionPlan.transitions.find((transition) => transition.targetNodeIds.some((id) => notifications.some((node) => node.id === id)));
    expect(notificationTransition?.targetNodeIds.sort()).toEqual(notifications.map((node) => node.id).sort());
    const defaultPlan = planPreview(graph);
    expect(defaultPlan.skippedNodeIds).toEqual(expect.arrayContaining([fork.id, ...notifications.map((node) => node.id)]));
    expect(defaultPlan.reachedNodeIds).toContain(report.id);
  });

  it("compiles supported thresholds and placeholder conditions as binary routers", () => {
    const supported = compileDescription("Notify the team only if confidence score > 80");
    const router = supported.nodes.find((node) => node.config.type === "router")!;
    expect(router.config).toMatchObject({
      type: "router",
      operand: "fixture.numericValue",
      operator: ">",
      comparisonValue: 80,
    });
    expect(validateArchitectGraph(supported).valid).toBe(true);

    const placeholder = compileDescription("Page the owner only if affected users > [YOUR_THRESHOLD]");
    const placeholderRouter = placeholder.nodes.find((node) => node.config.type === "router")!;
    expect(placeholderRouter.config).toMatchObject({ type: "router", operand: "unsupported", operator: "default" });
    expect(placeholder.extractionNotes.some((note) => note.kind === "placeholder")).toBe(true);
  });

  it("emits the disclosed all-unmatched graph rather than fallback", () => {
    const graph = compileDescription("Violet moons hum softly beyond glass");
    expect(graph.origin).toBe("local");
    expect(graph.nodes.map((node) => node.kind)).toEqual(["input", "action", "output"]);
    expect(graph.nodes[1].label).toContain("Unrecognized simulated step");
    expect(graph.extractionNotes.map((note) => note.message)).toContain("No actionable capability was recognized");
    expect((graph.nodes[1].config as { actionKind: string }).actionKind).toBe("reasoning");
  });

  it("constructs a fresh visible three-node fallback", () => {
    const graph = buildFallbackGraph("hello", "forced test failure");
    expect(graph.origin).toBe("local_fallback");
    expect(graph.nodes.map((node) => node.label)).toEqual(["Input", "Simulated step", "Output"]);
    expect(graph.extractionNotes[0].message).toContain("forced test failure");
    expect(validateArchitectGraph(graph).valid).toBe(true);
  });

  it("caps long drafts without producing node 16", () => {
    const graph = compileDescription(Array.from({ length: 30 }, (_, index) => `search topic ${index}`).join("; "));
    expect(graph.nodes.length).toBe(15);
    expect(graph.extractionNotes.some((note) => note.kind === "node_cap")).toBe(true);
  });
});

describe("typed policy slots and decision blocks", () => {
  it("derives deterministic semantic slots and a representative presentation subset without compiler inference", () => {
    const graph = compileDescription(exactPrompts[0]);
    const slots = derivePolicySlots(graph);
    const visible = selectPolicySlotsForPresentation(slots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.map((slot) => slot.id)).toEqual([...slots.map((slot) => slot.id)].sort());
    expect(visible.length).toBeLessThanOrEqual(POLICY_SLOT_LIMIT);
    expect(slots.some((slot) => slot.compatibleKinds.includes("context_gate"))).toBe(true);
    expect(slots.some((slot) => slot.compatibleKinds.includes("schema_gate"))).toBe(true);
    expect(slots.some((slot) => slot.compatibleKinds.includes("human_review"))).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "schema_gate" || node.kind === "context_gate")).toBe(false);
  });

  it("uses action kind plus a mutating verb for optional review recommendations", () => {
    expect(isReviewableSideEffect("notification", "inspect")).toBe(true);
    expect(isReviewableSideEffect("code_execution", "read")).toBe(true);
    expect(isReviewableSideEffect("file_operation", "write")).toBe(true);
    expect(isReviewableSideEffect("api_call", "update record")).toBe(true);
    for (const [kind, verb] of [
      ["api_call", "inspect"],
      ["api_call", "fetch"],
      ["file_operation", "read"],
      ["file_operation", "search"],
      ["knowledge_retrieval", "read"],
      ["web_search", "search"],
    ] as const) {
      expect(isReviewableSideEffect(kind, verb)).toBe(false);
    }

    const market = compileDescription(exactPrompts[0]);
    const reviewTargets = derivePolicySlots(market)
      .filter((slot) => slot.compatibleKinds.includes("human_review"))
      .map((slot) => market.nodes.find((node) => node.id === slot.targetNodeId)?.label);
    expect(reviewTargets).toEqual(expect.arrayContaining(["Page sales lead", "Build requested digest"]));
    expect(reviewTargets).not.toContain("Inspect pricing APIs");

    const triage = compileDescription(exactPrompts[1]);
    const triageReviewTargets = derivePolicySlots(triage)
      .filter((slot) => slot.compatibleKinds.includes("human_review"))
      .map((slot) => triage.nodes.find((node) => node.id === slot.targetNodeId)?.label);
    for (const readOnlyTarget of [
      "Read stack trace",
      "Search GitHub repository",
      "Query impacted users in Postgres",
    ]) {
      expect(triageReviewTargets).not.toContain(readOnlyTarget);
    }
  });

  it("counts every semantic slot while presenting at most six with every available kind represented", () => {
    let graph = buildFallbackGraph("policy presentation");
    let counters = initializeEditorCounters(graph);
    for (let index = 0; index < 7; index += 1) {
      const inserted = insertNodeOnEdge(graph, counters, graph.edges[0].id, {
        kind: "action",
        label: `Reasoning ${index}`,
        actionKind: "reasoning",
        operationVerb: "analyze",
      });
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) return;
      graph = inserted.graph;
      counters = inserted.counters;
    }
    const notification = insertNodeOnEdge(graph, counters, graph.edges.at(-1)!.id, {
      kind: "action",
      label: "Notify owner",
      actionKind: "notification",
      operationVerb: "notify",
    });
    expect(notification.ok).toBe(true);
    if (!notification.ok) return;
    graph = notification.graph;
    const semantic = derivePolicySlots(graph);
    const visible = selectPolicySlotsForPresentation(semantic);
    expect(semantic.length).toBeGreaterThan(POLICY_SLOT_LIMIT);
    expect(visible).toHaveLength(POLICY_SLOT_LIMIT);
    const availableKinds = new Set(semantic.flatMap((slot) => slot.compatibleKinds));
    const visibleKinds = new Set(visible.flatMap((slot) => slot.compatibleKinds));
    expect(visibleKinds).toEqual(availableKinds);
    expect(constraintMapEvidence(graph).unresolvedDecisionSlotCount).toBe(semantic.length);
  });

  it("inserts through the exact eligible edge and preserves a router source handle", () => {
    const graph = compileDescription(exactPrompts[0]);
    const counters = initializeEditorCounters(graph);
    const slot = derivePolicySlots(graph).find((candidate) => {
      const edge = graph.edges.find((item) => item.id === candidate.edgeId);
      return candidate.compatibleKinds.includes("context_gate") && Boolean(edge?.sourceHandle);
    })!;
    const original = graph.edges.find((edge) => edge.id === slot.edgeId)!;
    const result = insertPolicyNodeOnEdge(graph, counters, slot.edgeId, "context_gate");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inserted = result.graph.nodes.find((node) => node.kind === "context_gate")!;
    expect(inserted.config).toEqual({
      type: "context_gate",
      tokenCap: 4_000,
      strategy: "select",
      allowedSources: ["workflow input"],
      blockedFields: [],
    });
    expect(result.graph.edges.find((edge) => edge.source === original.source && edge.target === inserted.id)?.sourceHandle)
      .toBe(original.sourceHandle);
    expect(validateArchitectGraph(result.graph)).toEqual({ valid: true, errors: [] });
  });

  it("rejects incompatible and full-graph drops without mutating graph or counters", () => {
    let graph = compileDescription(exactPrompts[0]);
    let counters = initializeEditorCounters(graph);
    const incompatible = derivePolicySlots(graph).find((slot) => slot.compatibleKinds.includes("human_review") && !slot.compatibleKinds.includes("schema_gate"))!;
    const graphBefore = structuredClone(graph);
    const countersBefore = { ...counters };
    expect(insertPolicyNodeOnEdge(graph, counters, incompatible.edgeId, "schema_gate").ok).toBe(false);
    expect(graph).toEqual(graphBefore);
    expect(counters).toEqual(countersBefore);

    while (graph.nodes.length < 15) {
      const edge = graph.edges.find((candidate) => candidate.source === "input-1")!;
      const added = insertNodeOnEdge(graph, counters, edge.id, { kind: "action", label: "Capacity filler", actionKind: "web_search" });
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      graph = added.graph;
      counters = added.counters;
    }
    const slot = derivePolicySlots(graph)[0];
    const fullGraph = structuredClone(graph);
    const fullCounters = { ...counters };
    const rejected = insertPolicyNodeOnEdge(graph, counters, slot.edgeId, slot.compatibleKinds[0]);
    expect(rejected.ok).toBe(false);
    expect(graph).toEqual(fullGraph);
    expect(counters).toEqual(fullCounters);
  });

  it("strictly validates and canonicalizes every editable config and stales preview evidence", () => {
    let graph = compileDescription(exactPrompts[0]);
    let counters = initializeEditorCounters(graph);
    for (const kind of ["context_gate", "schema_gate", "human_review"] as const) {
      const slot = derivePolicySlots(graph).find((candidate) => candidate.compatibleKinds.includes(kind))!;
      const inserted = insertPolicyNodeOnEdge(graph, counters, slot.edgeId, kind);
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) return;
      graph = inserted.graph;
      counters = inserted.counters;
    }
    const evaluatorInsert = insertNodeOnEdge(graph, counters, graph.edges[0].id, { kind: "evaluator", label: "Policy evaluator" });
    expect(evaluatorInsert.ok).toBe(true);
    if (!evaluatorInsert.ok) return;
    graph = evaluatorInsert.graph;
    counters = evaluatorInsert.counters;

    const schema = graph.nodes.find((node) => node.kind === "schema_gate")!;
    const context = graph.nodes.find((node) => node.kind === "context_gate")!;
    const review = graph.nodes.find((node) => node.kind === "human_review")!;
    const action = graph.nodes.find((node) => node.config.type === "action")!;
    const evaluator = graph.nodes.find((node) => node.kind === "evaluator")!;
    const router = graph.nodes.find((node) => node.kind === "router")!;
    const updates: Array<[string, ArchitectGraph["nodes"][number]["config"]]> = [
      [schema.id, { type: "schema_gate", contractName: "ResearchBrief", mode: "strip_unknown", requiredFields: ["summary", "citations"], violationBehavior: "review" }],
      [context.id, { type: "context_gate", tokenCap: 2_048, strategy: "summarize", allowedSources: ["brief", "knowledge base"], blockedFields: ["credentials"] }],
      [review.id, { type: "human_review", instruction: "Approve the represented side effect" }],
      [action.id, { type: "action", actionKind: "code_execution", operationVerb: "inspect", simulated: true }],
      [evaluator.id, { type: "evaluator", criterion: "Check configured symbolic evidence" }],
      [router.id, { ...(router.config as RouterConfig), displayCondition: "fixture.booleanFlag is configured" }],
    ];
    for (const [nodeId, config] of updates) {
      const result = updateNodeConfig(graph, counters, nodeId, config);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      graph = result.graph;
      counters = result.counters;
      let state = createArchitectState();
      state = architectReducer(state, { type: "SET_PROMPT", prompt: exactPrompts[0] });
      state = architectReducer(state, { type: "REQUEST_COMPILE" });
      state = architectReducer(state, { type: "START_PREVIEW" });
      state = { ...state, graph: cloneGraph(graph), counters: { ...counters } };
      state = architectReducer(state, { type: "UPDATE_NODE_CONFIG", nodeId, config });
      expect(state.run.status).toBe("stale");
      expect(validateArchitectGraph(state.graph!)).toEqual({ valid: true, errors: [] });
    }
    const canonical = canonicalArchitectJson(graph);
    expect(canonical).toContain('"contractName":"ResearchBrief"');
    expect(canonical).toContain('"tokenCap":2048');
    expect(constraintMapEvidence(graph)).toMatchObject({
      schemaGateCount: 1,
      contextBoundaryCount: 1,
      humanReviewCount: 1,
    });

    const plan = planPreview(graph, { booleanFlag: true });
    const steps = [...plan.initialEvents, ...plan.transitions.flatMap((transition) => transition.events)].map((event) => event.step);
    expect(steps.find((step) => step.includes("Schema contract configured"))).toContain("no live schema validation");
    expect(steps.find((step) => step.includes("Context boundary configured"))).toContain("fixture symbolic units");
    expect(steps.join(" ")).not.toMatch(/Pydantic executed|measured [0-9]+ tokens/i);
  });
});

describe("semantic validation and canonicalization", () => {
  it("canonicalizes reordered arrays equally and ignores position/display labels", () => {
    const graph = compileDescription(exactPrompts[0]);
    const edited = cloneGraph(graph);
    edited.nodes.reverse();
    edited.edges.reverse();
    edited.nodes[0].position = { x: 999, y: -300 };
    edited.nodes[0].label = "A display-only rename";
    expect(canonicalArchitectJson(edited)).toBe(canonicalArchitectJson(graph));
  });

  it("has a fixed exact canonical string for the minimal graph", () => {
    const graph = buildFallbackGraph("x", "test");
    expect(canonicalArchitectJson(graph)).toBe(
      '{"schemaVersion":"architect.graph.v1","lexiconVersion":"architect.lexicon.v1","nodes":[{"id":"action-1","kind":"action","config":{"actionKind":"reasoning","operationVerb":"simulate","simulated":true}},{"id":"input-1","kind":"input","config":{}},{"id":"output-1","kind":"output","config":{}}],"edges":[{"id":"edge-action-1-next-output-1-in","source":"action-1","target":"output-1"},{"id":"edge-input-1-next-action-1-in","source":"input-1","target":"action-1"}]}',
    );
  });

  it("canonicalizes set-like policy lists without changing displayed order or preview identity", () => {
    let graph = compileDescription(exactPrompts[0]);
    let counters = initializeEditorCounters(graph);
    for (const kind of ["schema_gate", "context_gate"] as const) {
      const slot = derivePolicySlots(graph).find((candidate) => candidate.compatibleKinds.includes(kind))!;
      const inserted = insertPolicyNodeOnEdge(graph, counters, slot.edgeId, kind);
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) return;
      graph = inserted.graph;
      counters = inserted.counters;
    }
    const schema = graph.nodes.find((node) => node.config.type === "schema_gate")!;
    const context = graph.nodes.find((node) => node.config.type === "context_gate")!;
    if (schema.config.type !== "schema_gate" || context.config.type !== "context_gate") return;
    schema.config.requiredFields = ["summary", "citations", "owner"];
    context.config.allowedSources = ["workflow input", "handbook", "brief"];
    context.config.blockedFields = ["credentials", "secrets", "tokens"];
    const reversed = cloneGraph(graph);
    const reversedSchema = reversed.nodes.find((node) => node.id === schema.id)!;
    const reversedContext = reversed.nodes.find((node) => node.id === context.id)!;
    if (reversedSchema.config.type !== "schema_gate" || reversedContext.config.type !== "context_gate") return;
    reversedSchema.config.requiredFields.reverse();
    reversedContext.config.allowedSources.reverse();
    reversedContext.config.blockedFields.reverse();
    expect(reversedSchema.config.requiredFields).not.toEqual(schema.config.requiredFields);
    expect(canonicalArchitectJson(reversed)).toBe(canonicalArchitectJson(graph));
    expect(planPreview(reversed).runId).toBe(planPreview(graph).runId);
  });

  it("rejects duplicate IDs, bad handles, cycles, orphans, and node 16 without mutating input", () => {
    const base = compileDescription(exactPrompts[0]);
    const variants: ArchitectGraph[] = [];
    const duplicate = cloneGraph(base);
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    variants.push(duplicate);
    const handle = cloneGraph(base);
    handle.edges.find((edge) => handle.nodes.find((node) => node.id === edge.source)?.kind === "router")!.sourceHandle = "missing-route";
    variants.push(handle);
    const cycle = cloneGraph(base);
    cycle.edges.push({ id: "cycle", source: cycle.nodes[cycle.nodes.length - 1].id, target: cycle.nodes[0].id });
    variants.push(cycle);
    const orphan = cloneGraph(base);
    orphan.edges = orphan.edges.filter((edge) => edge.target !== orphan.nodes[1].id);
    variants.push(orphan);
    const over = cloneGraph(base);
    over.nodes.push({ ...structuredClone(over.nodes[1]), id: "node-16", label: "sixteenth" });
    variants.push(over);
    for (const graph of variants) {
      const before = structuredClone(graph);
      expect(validateArchitectGraph(graph).valid).toBe(false);
      expect(graph).toEqual(before);
    }
  });

  it("enforces the explicit target-handle contract without mutation", () => {
    const base = buildFallbackGraph("target handles");
    const validWithIn = cloneGraph(base);
    validWithIn.edges[0].targetHandle = "in";
    expect(validateArchitectGraph(validWithIn)).toEqual({ valid: true, errors: [] });
    expect(validateArchitectGraph(base)).toEqual({ valid: true, errors: [] });

    const bogus = cloneGraph(base);
    bogus.edges[0].targetHandle = "bogus";
    const beforeBogus = structuredClone(bogus);
    expect(validateArchitectGraph(bogus).errors.some((error) => error.includes("invalid target handle"))).toBe(true);
    expect(bogus).toEqual(beforeBogus);

    const targetsInput = cloneGraph(base);
    targetsInput.edges[0].target = targetsInput.nodes.find((node) => node.kind === "input")!.id;
    targetsInput.edges[0].targetHandle = "in";
    expect(validateArchitectGraph(targetsInput).errors.some((error) => error.includes("cannot target the input"))).toBe(true);

    const routerGraph = compileDescription(exactPrompts[0]);
    const routerEdge = routerGraph.edges.find((edge) => routerGraph.nodes.find((node) => node.id === edge.source)?.kind === "router")!;
    routerEdge.sourceHandle = "malformed-route";
    expect(validateArchitectGraph(routerGraph).errors.some((error) => error.includes("valid route handle"))).toBe(true);
  });
});

describe("deterministic reached-DAG preview", () => {
  it("selects supported true and false routes and preserves shared descendants", () => {
    const graph = compileDescription(exactPrompts[0]);
    const flagged = graph.nodes.find((node) => node.label === "Anything flagged?")!;
    const priceDrop = graph.nodes.find((node) => node.label === "Price drop greater than 10%?")!;
    const sentiment = graph.nodes.find((node) => node.label === "Analyze flagged sentiment")!;
    const page = graph.nodes.find((node) => node.label === "Page sales lead")!;
    const digest = graph.nodes.find((node) => node.label === "Build requested digest")!;

    const falsePlan = planPreview(graph);
    expect(falsePlan.skippedNodeIds).toContain(sentiment.id);
    expect(falsePlan.reachedNodeIds).toContain(priceDrop.id);
    expect(falsePlan.reachedNodeIds).toContain(digest.id);
    expect(falsePlan.skippedNodeIds).toContain(page.id);

    const truePlan = planPreview(graph, { booleanFlag: true, numericValue: 20 });
    expect(truePlan.reachedNodeIds).toEqual(expect.arrayContaining([sentiment.id, priceDrop.id, page.id]));
    expect(truePlan.skippedNodeIds).toContain(digest.id);
    const flaggedEvent = truePlan.transitions.flatMap((transition) => transition.events).find((event) => event.nodeId === flagged.id)!;
    expect(flaggedEvent.reason).toContain("evaluated true");
  });

  it("uses supported true/false routes and exact unsupported default reasoning", () => {
    const graph = compileDescription(exactPrompts[1]);
    const router = graph.nodes.find((node) => node.config.type === "router")!;
    const config = router.config as RouterConfig;
    const plan = planPreview(graph);
    const decision = evaluateRouter(config, plan.fixture);
    expect(decision.selectedRouteId).toBe(config.defaultRouteId);
    expect(decision.reason).toContain("Unsupported condition");
    expect(plan.skippedNodeIds).toContain(graph.edges.find((edge) => edge.source === router.id && edge.sourceHandle === config.conditionRouteId)!.target);
  });

  it("waits for all reached parallel predecessors and never schedules an unselected route", () => {
    const graph = compileDescription("Search the web and query the database simultaneously then draft a report");
    const plan = planPreview(graph);
    const report = graph.nodes.find((node) => /draft/i.test(node.label))!;
    const transition = plan.transitions.find((item) => item.targetNodeIds.includes(report.id))!;
    expect(transition.edgeIds).toHaveLength(2);
    expect(plan.reachedNodeIds).toContain(report.id);
  });

  it("does not call network or browser service adapters", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const graph = compileDescription(exactPrompts[0]);
    planPreview(graph);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("600ms preview driver lifecycle", () => {
  function fakeScheduler() {
    let time = 0;
    let nextId = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const scheduler: PreviewAnimationScheduler = {
      now: () => time,
      request: (callback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      cancel: (id) => { callbacks.delete(id); },
    };
    return {
      scheduler,
      advance(ms: number) {
        time += ms;
        const ready = [...callbacks.values()];
        callbacks.clear();
        ready.forEach((callback) => callback(time));
      },
      pending: () => callbacks.size,
    };
  }

  it("completes at exactly 600ms and resumes from the paused remainder", () => {
    expect(PREVIEW_TRANSITION_MS).toBe(600);
    const clock = fakeScheduler();
    const ticks: number[] = [];
    const complete = vi.fn();
    let stop = startPreviewTransitionDriver(0, { onTick: (value) => ticks.push(value), onComplete: complete }, clock.scheduler);
    clock.advance(300);
    expect(ticks[ticks.length - 1]).toBe(300);
    stop();
    expect(clock.pending()).toBe(0);

    stop = startPreviewTransitionDriver(300, { onTick: (value) => ticks.push(value), onComplete: complete }, clock.scheduler);
    clock.advance(299);
    expect(ticks[ticks.length - 1]).toBe(599);
    expect(complete).not.toHaveBeenCalled();
    clock.advance(1);
    expect(ticks[ticks.length - 1]).toBe(600);
    expect(complete).toHaveBeenCalledOnce();
    expect(clock.pending()).toBe(0);
    stop();
  });

  it("Strict Mode-equivalent setup/cleanup leaves one driver and no orphan callback", () => {
    const clock = fakeScheduler();
    const tick = vi.fn();
    const firstCleanup = startPreviewTransitionDriver(0, { onTick: tick, onComplete: vi.fn() }, clock.scheduler);
    firstCleanup();
    const secondCleanup = startPreviewTransitionDriver(0, { onTick: tick, onComplete: vi.fn() }, clock.scheduler);
    expect(clock.pending()).toBe(1);
    clock.advance(100);
    expect(tick).toHaveBeenCalledTimes(1);
    secondCleanup();
    expect(clock.pending()).toBe(0);
    clock.advance(1000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("visibility subscription pauses, resumes, and removes its listener", () => {
    let hidden = false;
    let listener: (() => void) | undefined;
    const target = {
      get hidden() { return hidden; },
      addEventListener: (_name: string, callback: EventListenerOrEventListenerObject) => {
        listener = callback as () => void;
      },
      removeEventListener: (_name: string, callback: EventListenerOrEventListenerObject) => {
        if (listener === callback) listener = undefined;
      },
    } as Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
    const pause = vi.fn();
    const resume = vi.fn();
    const cleanup = subscribePreviewVisibility(pause, resume, target);
    hidden = true;
    listener?.();
    hidden = false;
    listener?.();
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    cleanup();
    expect(listener).toBeUndefined();
  });
});

describe("atomic graph transactions and state", () => {
  it("inserts, deletes, renames routes, swaps defaults, and never reuses IDs", () => {
    const graph = buildFallbackGraph("test");
    const counters = initializeEditorCounters(graph);
    const inserted = insertNodeOnEdge(graph, counters, graph.edges[0].id, { kind: "action", label: "Inserted" });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.graph.nodes.some((node) => node.id === "editor-node-1")).toBe(true);
    const removed = deleteLinearNode(inserted.graph, inserted.counters, "editor-node-1");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const next = insertNodeOnEdge(removed.graph, removed.counters, removed.graph.edges[0].id, { kind: "evaluator", label: "Next" });
    expect(next.ok && next.graph.nodes.some((node) => node.id === "editor-node-2")).toBe(true);

    const routerResult = insertRouterOnEdge(graph, counters, graph.edges[0].id, { label: "Guard", displayCondition: "unknown" });
    expect(routerResult.ok).toBe(true);
    if (!routerResult.ok) return;
    const router = routerResult.graph.nodes.find((node) => node.config.type === "router")!;
    const config = router.config as RouterConfig;
    const renamed = renameRouteId(routerResult.graph, routerResult.counters, router.id, config.conditionRouteId, "condition-renamed");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.graph.edges.some((edge) => edge.sourceHandle === "condition-renamed")).toBe(true);
    const swapped = swapDefaultRoute(renamed.graph, renamed.counters, router.id, "condition-renamed");
    expect(swapped.ok && (swapped.graph.nodes.find((node) => node.id === router.id)!.config as RouterConfig).defaultRouteId).toBe("condition-renamed");

    const routeEdge = routerResult.graph.edges.find((edge) => edge.source === router.id)!;
    const reconnected = reconnectEdge(routerResult.graph, routerResult.counters, routeEdge.id, routeEdge.target);
    expect(reconnected.ok).toBe(true);
    if (reconnected.ok) {
      expect(reconnected.graph.edges.find((edge) => edge.id === routeEdge.id)?.sourceHandle).toBe(routeEdge.sourceHandle);
    }
  });

  it("rejects atomically without advancing counters and marks an edited run stale", () => {
    let state = createArchitectState();
    state = architectReducer(state, { type: "SET_PROMPT", prompt: "Search the web then draft a report" });
    state = architectReducer(state, { type: "REQUEST_COMPILE" });
    state = architectReducer(state, { type: "START_PREVIEW" });
    const beforeGraph = structuredClone(state.graph);
    const beforeCounters = { ...state.counters };
    state = architectReducer(state, { type: "DISCONNECT", edgeId: state.graph!.edges[0].id });
    expect(state.graph).toEqual(beforeGraph);
    expect(state.counters).toEqual(beforeCounters);
    expect(state.editError).toBeTruthy();

    state = architectReducer(state, { type: "RENAME_NODE", nodeId: state.graph!.nodes[1].id, label: "Renamed" });
    expect(state.run.status).toBe("stale");
    expect(state.draftStatus).toBe("dirty");
  });

  it("preserves prompt staleness and requires dirty replacement confirmation", () => {
    let state = createArchitectState();
    state = architectReducer(state, { type: "SET_PROMPT", prompt: "Search the web" });
    state = architectReducer(state, { type: "REQUEST_COMPILE" });
    state = architectReducer(state, { type: "RENAME_NODE", nodeId: state.graph!.nodes[1].id, label: "Edited" });
    const edited = state.graph;
    state = architectReducer(state, { type: "SET_PROMPT", prompt: "Query the database" });
    expect(state.promptStatus).toBe("description_changed");
    state = architectReducer(state, { type: "REQUEST_COMPILE" });
    expect(state.replacementPending).toBe(true);
    expect(state.graph).toBe(edited);
    state = architectReducer(state, { type: "CANCEL_REPLACE" });
    expect(state.graph).toBe(edited);
    state = architectReducer(state, { type: "REQUEST_COMPILE" });
    state = architectReducer(state, { type: "CONFIRM_REPLACE" });
    expect(state.graph?.descriptionSnapshot).toBe("Query the database");
    expect(state.draftStatus).toBe("clean");
  });
});
