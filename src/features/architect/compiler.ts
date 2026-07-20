import { validateArchitectGraph } from "./graph";
import { ARCHITECT_TEMPLATES } from "./templates";
import {
  ARCHITECT_GRAPH_VERSION,
  ARCHITECT_LEXICON_VERSION,
  type ActionKind,
  type ArchitectEdge,
  type ArchitectGraph,
  type ArchitectNode,
  type ExtractionNote,
  type NodeKind,
  type RouterConfig,
  type RouterOperand,
  type RouterOperator,
} from "./types";

interface RouterDescription {
  label: string;
  condition: string;
  operand: RouterOperand;
  operator: RouterOperator;
  comparisonValue?: number | boolean | string;
  conditionLabel: string;
  defaultLabel: string;
}

class GraphBuilder {
  nodes: ArchitectNode[] = [];
  edges: ArchitectEdge[] = [];
  notes: ExtractionNote[] = [];
  private occurrences = new Map<NodeKind, number>();
  private edgeOccurrences = new Map<string, number>();

  constructor(private readonly descriptionSnapshot: string) {}

  addNode(kind: NodeKind, label: string, config?: Partial<ArchitectNode["config"]>): ArchitectNode {
    const occurrence = (this.occurrences.get(kind) ?? 0) + 1;
    this.occurrences.set(kind, occurrence);
    const node: ArchitectNode = {
      id: `${kind}-${occurrence}`,
      kind,
      label: label.slice(0, 180),
      position: { x: 0, y: 0 },
      config: (
        kind === "action"
          ? { type: "action", actionKind: "reasoning", operationVerb: "process", simulated: true, ...config }
          : kind === "router"
            ? config
            : kind === "evaluator"
              ? { type: "evaluator", criterion: "Evaluate the stated criterion", ...config }
              : kind === "human_review"
                ? { type: "human_review", instruction: "Review the draft", ...config }
                : { type: kind }
      ) as ArchitectNode["config"],
    };
    this.nodes.push(node);
    return node;
  }

  addAction(label: string, actionKind: ActionKind, operationVerb: string): ArchitectNode {
    return this.addNode("action", label, {
      type: "action",
      actionKind,
      operationVerb: operationVerb.slice(0, 80),
      simulated: true,
    });
  }

  addRouter(description: RouterDescription): ArchitectNode {
    const occurrence = (this.occurrences.get("router") ?? 0) + 1;
    const routerId = `router-${occurrence}`;
    const conditionRouteId = `route-${routerId}-condition`;
    const defaultRouteId = `route-${routerId}-default`;
    return this.addNode("router", description.label, {
      type: "router",
      displayCondition: description.condition,
      operand: description.operand,
      operator: description.operator,
      ...(description.comparisonValue === undefined ? {} : { comparisonValue: description.comparisonValue }),
      routes: [
        { id: conditionRouteId, label: description.conditionLabel, role: "condition" },
        { id: defaultRouteId, label: description.defaultLabel, role: "default" },
      ],
      conditionRouteId,
      defaultRouteId,
    } as RouterConfig);
  }

  connect(source: ArchitectNode, target: ArchitectNode, sourceHandle?: string, targetHandle?: string) {
    const stem = `edge-${source.id}-${sourceHandle ?? "next"}-${target.id}-${targetHandle ?? "in"}`;
    const ordinal = (this.edgeOccurrences.get(stem) ?? 0) + 1;
    this.edgeOccurrences.set(stem, ordinal);
    this.edges.push({
      id: ordinal === 1 ? stem : `${stem}-${ordinal}`,
      source: source.id,
      target: target.id,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
    });
  }

  note(kind: ExtractionNote["kind"], message: string, sourceStart?: number, sourceEnd?: number) {
    this.notes.push({
      id: `note-${this.notes.length + 1}`,
      kind,
      message: message.slice(0, 500),
      ...(sourceStart === undefined ? {} : { sourceStart }),
      ...(sourceEnd === undefined ? {} : { sourceEnd }),
    });
  }

  build(origin: ArchitectGraph["origin"] = "local"): ArchitectGraph {
    layoutGraph(this.nodes, this.edges);
    return {
      schemaVersion: ARCHITECT_GRAPH_VERSION,
      lexiconVersion: ARCHITECT_LEXICON_VERSION,
      descriptionSnapshot: this.descriptionSnapshot,
      nodes: this.nodes,
      edges: this.edges,
      extractionNotes: this.notes,
      origin,
    };
  }
}

function layoutGraph(nodes: ArchitectNode[], edges: ArchitectEdge[]) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const level = new Map(queue.map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of outgoing.get(id) ?? []) {
      level.set(target, Math.max(level.get(target) ?? 0, (level.get(id) ?? 0) + 1));
      const next = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  const atLevel = new Map<number, ArchitectNode[]>();
  for (const node of nodes) {
    const depth = level.get(node.id) ?? 0;
    atLevel.set(depth, [...(atLevel.get(depth) ?? []), node]);
  }
  for (const [depth, row] of atLevel) {
    row.sort((a, b) => a.id.localeCompare(b.id));
    row.forEach((node, index) => {
      node.position = { x: depth * 290, y: (index - (row.length - 1) / 2) * 180 };
    });
  }
}

function baseBuilder(snapshot: string, inputLabel: string) {
  const builder = new GraphBuilder(snapshot);
  const input = builder.addNode("input", inputLabel);
  return { builder, input };
}

function marketIntel(snapshot: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "Schedule input");
  const news = builder.addAction("Search competitor news", "web_search", "search");
  const pricing = builder.addAction("Inspect pricing APIs", "api_call", "inspect");
  const crm = builder.addAction("Read lost deals from Postgres CRM", "knowledge_retrieval", "read");
  const flagged = builder.addRouter({
    label: "Anything flagged?",
    condition: "fixture.booleanFlag is true",
    operand: "fixture.booleanFlag",
    operator: "truthy",
    conditionLabel: "Analyze sentiment",
    defaultLabel: "Bypass sentiment",
  });
  const sentiment = builder.addAction("Analyze flagged sentiment", "reasoning", "analyze");
  const priceDrop = builder.addRouter({
    label: "Price drop greater than 10%?",
    condition: "fixture.numericValue > 10",
    operand: "fixture.numericValue",
    operator: ">",
    comparisonValue: 10,
    conditionLabel: "Page sales lead",
    defaultLabel: "Build digest",
  });
  const page = builder.addAction("Page sales lead", "notification", "page");
  const digest = builder.addAction("Build requested digest", "file_operation", "write");
  const output = builder.addNode("output", "Delivery output");
  builder.connect(input, news);
  builder.connect(news, pricing);
  builder.connect(pricing, crm);
  builder.connect(crm, flagged);
  const flaggedConfig = flagged.config as RouterConfig;
  builder.connect(flagged, sentiment, flaggedConfig.conditionRouteId);
  builder.connect(sentiment, priceDrop);
  builder.connect(flagged, priceDrop, flaggedConfig.defaultRouteId);
  const dropConfig = priceDrop.config as RouterConfig;
  builder.connect(priceDrop, page, dropConfig.conditionRouteId);
  builder.connect(priceDrop, digest, dropConfig.defaultRouteId);
  builder.connect(page, output);
  builder.connect(digest, output);
  builder.note("placeholder", "Bracketed company, product, and output choices remain unresolved.");
  return builder.build();
}

function bugTriage(snapshot: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "Sentry alert input");
  const stack = builder.addAction("Read stack trace", "file_operation", "read");
  const repo = builder.addAction("Search GitHub repository", "file_operation", "search");
  const users = builder.addAction("Query impacted users in Postgres", "knowledge_retrieval", "query");
  const knowledge = builder.addAction("Read prior incidents from Confluence", "knowledge_retrieval", "read");
  const report = builder.addAction("Draft incident report", "reasoning", "draft");
  const affected = builder.addRouter({
    label: "Affected users above threshold?",
    condition: "Affected users > [YOUR_THRESHOLD]",
    operand: "unsupported",
    operator: "default",
    conditionLabel: "Page on-call",
    defaultLabel: "Do not page",
  });
  const page = builder.addAction("Page on-call", "notification", "page");
  const noPage = builder.addAction("Record no-page outcome", "notification", "record");
  const output = builder.addNode("output", "Incident report output");
  [input, stack, repo, users, knowledge, report, affected].reduce((previous, node) => {
    if (previous !== node) builder.connect(previous, node);
    return node;
  });
  const config = affected.config as RouterConfig;
  builder.connect(affected, page, config.conditionRouteId);
  builder.connect(affected, noPage, config.defaultRouteId);
  builder.connect(page, output);
  builder.connect(noPage, output);
  builder.note("placeholder", "[YOUR_THRESHOLD] is unresolved; preview always takes the named default route.");
  builder.note("placeholder", "Bracketed company, service, and report choices remain unresolved.");
  return builder.build();
}

function contentRepurposer(snapshot: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "New content input");
  const trend = builder.addAction("Search trending discussions", "web_search", "search");
  const past = builder.addAction("Retrieve past content", "knowledge_retrieval", "retrieve");
  const compose = builder.addAction("Compose requested formats", "reasoning", "compose");
  const fact = builder.addAction("Fact-check statistics", "web_search", "check");
  const brand = builder.addNode("evaluator", "Evaluate brand voice", { type: "evaluator", criterion: "Brand voice consistency" });
  const contradictions = builder.addAction("Check last-quarter contradictions", "knowledge_retrieval", "check");
  const confidence = builder.addRouter({
    label: "Confidence score above 85%?",
    condition: "fixture.numericValue > 85",
    operand: "fixture.numericValue",
    operator: ">",
    comparisonValue: 85,
    conditionLabel: "Publish",
    defaultLabel: "Flag for review",
  });
  const publish = builder.addAction("Publish content", "notification", "publish");
  const review = builder.addNode("human_review", "Flag for human review", { type: "human_review", instruction: "Review low-confidence content" });
  const output = builder.addNode("output", "Publication decision output");
  const sequence = [input, trend, past, compose, fact, brand, contradictions, confidence];
  for (let i = 0; i < sequence.length - 1; i += 1) builder.connect(sequence[i], sequence[i + 1]);
  const config = confidence.config as RouterConfig;
  builder.connect(confidence, publish, config.conditionRouteId);
  builder.connect(confidence, review, config.defaultRouteId);
  builder.connect(publish, output);
  builder.connect(review, output);
  builder.note("placeholder", "Bracketed content, topic, and format choices remain unresolved.");
  return builder.build();
}

function orderPipeline(snapshot: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "Order stream input");
  const payment = builder.addNode("evaluator", "Evaluate payment validity", { type: "evaluator", criterion: "Payment validity" });
  const valid = builder.addRouter({
    label: "Payment valid?",
    condition: "fixture.booleanFlag is true",
    operand: "fixture.booleanFlag",
    operator: "truthy",
    conditionLabel: "Continue to inventory",
    defaultLabel: "Dead-letter",
  });
  const inventory = builder.addAction("Read real-time warehouse inventory", "knowledge_retrieval", "read");
  const deadLetter = builder.addAction("Write dead-letter outcome", "file_operation", "write");
  const amount = builder.addRouter({
    label: "Order matches fraud-scoring choice?",
    condition: "[orders over $500 / all orders]",
    operand: "unsupported",
    operator: "default",
    conditionLabel: "Run fraud scoring",
    defaultLabel: "Bypass fraud scoring",
  });
  const fraud = builder.addNode("evaluator", "Evaluate fraud score", { type: "evaluator", criterion: "Fraud scoring" });
  const discount = builder.addAction("Apply requested discount logic", "reasoning", "apply");
  const reserve = builder.addAction("Write inventory reservation transaction", "file_operation", "write");
  const confirmed = builder.addAction("Write confirmed order", "file_operation", "write");
  const event = builder.addAction("Emit fulfillment event", "notification", "emit");
  const output = builder.addNode("output", "Order processing output");
  builder.connect(input, payment);
  builder.connect(payment, valid);
  const validConfig = valid.config as RouterConfig;
  builder.connect(valid, inventory, validConfig.conditionRouteId);
  builder.connect(valid, deadLetter, validConfig.defaultRouteId);
  builder.connect(deadLetter, output);
  builder.connect(inventory, amount);
  const amountConfig = amount.config as RouterConfig;
  builder.connect(amount, fraud, amountConfig.conditionRouteId);
  builder.connect(amount, discount, amountConfig.defaultRouteId);
  builder.connect(fraud, discount);
  builder.connect(discount, reserve);
  builder.connect(reserve, confirmed);
  builder.connect(confirmed, event);
  builder.connect(event, output);
  builder.note("placeholder", "The fraud-scoring bracket is a choice, not a supported numeric threshold; preview uses its default route.");
  builder.note("placeholder", "Industry, volume, and discount placeholders remain unresolved.");
  return builder.build();
}

function dueDiligence(snapshot: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "Company name input");
  const funding = builder.addAction("Search funding rounds and press", "web_search", "search");
  const jobs = builder.addAction("Inspect company job board", "web_search", "inspect");
  const filings = builder.addAction("Retrieve public filings", "knowledge_retrieval", "retrieve");
  const notes = builder.addAction("Read internal deal notes", "knowledge_retrieval", "read");
  const swot = builder.addAction("Compose SWOT synthesis", "reasoning", "compose");
  const coverage = builder.addRouter({
    label: "Web coverage feels thin?",
    condition: "fixture.booleanFlag is true",
    operand: "fixture.booleanFlag",
    operator: "truthy",
    conditionLabel: "Revise once",
    defaultLabel: "Bypass revision",
  });
  const revision = builder.addAction("Revise report once", "reasoning", "revise");
  const report = builder.addAction("Build requested report", "file_operation", "write");
  const output = builder.addNode("output", "Deal research output");
  const sequence = [input, funding, jobs, filings, notes, swot, coverage];
  for (let i = 0; i < sequence.length - 1; i += 1) builder.connect(sequence[i], sequence[i + 1]);
  const config = coverage.config as RouterConfig;
  builder.connect(coverage, revision, config.conditionRouteId);
  builder.connect(revision, report);
  builder.connect(coverage, report, config.defaultRouteId);
  builder.connect(report, output);
  builder.note("placeholder", "Bracketed role, firm, report, and comps-table choices remain unresolved.");
  builder.note("ambiguous", "The pivot flag is retained as an unmatched disclosure rather than an invented condition.");
  return builder.build();
}

const presetCompilers: Record<string, (snapshot: string) => ArchitectGraph> = {
  "market-intel": marketIntel,
  "bug-triage": bugTriage,
  "content-repurposer": contentRepurposer,
  "order-pipeline": orderPipeline,
  "due-diligence": dueDiligence,
};

interface Clause {
  text: string;
  start: number;
  end: number;
}

export function splitArchitectClauses(text: string): Clause[] {
  return splitProtected(text, 0, new Set([".", ";", "\n", ":"]), new Set());
}

function splitProtected(
  text: string,
  baseStart: number,
  characterDelimiters: Set<string>,
  wordDelimiters: Set<string>,
): Clause[] {
  const segments: Clause[] = [];
  let quote: string | null = null;
  const brackets: string[] = [];
  let start = 0;
  const opening: Record<string, string> = { "[": "]", "(": ")", "{": "}" };

  const push = (rawStart: number, rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd);
    const value = raw.trim();
    if (!value) return;
    const leading = raw.indexOf(value);
    const segmentStart = baseStart + rawStart + leading;
    segments.push({ text: value, start: segmentStart, end: segmentStart + value.length });
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const apostropheInsideWord = character === "'"
      && /[A-Za-z0-9]/.test(text[index - 1] ?? "")
      && /[A-Za-z0-9]/.test(text[index + 1] ?? "");
    if ((character === '"' || character === "'") && !apostropheInsideWord && text[index - 1] !== "\\") {
      quote = quote === character ? null : quote ? quote : character;
      continue;
    }
    if (quote) continue;
    if (opening[character]) {
      brackets.push(opening[character]);
      continue;
    }
    if (brackets[brackets.length - 1] === character) {
      brackets.pop();
      continue;
    }
    if (brackets.length) continue;

    const decimalPoint = character === "."
      && /\d/.test(text[index - 1] ?? "")
      && /\d/.test(text[index + 1] ?? "");
    if (characterDelimiters.has(character) && !decimalPoint) {
      push(start, index);
      start = index + 1;
      continue;
    }
    for (const word of wordDelimiters) {
      if (text.slice(index, index + word.length).toLowerCase() !== word) continue;
      const before = text[index - 1] ?? " ";
      const after = text[index + word.length] ?? " ";
      if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue;
      push(start, index);
      start = index + word.length;
      index += word.length - 1;
      break;
    }
  }
  push(start, text.length);
  return segments;
}

function operationSegments(clause: Clause): Clause[] {
  return splitProtected(clause.text, clause.start, new Set([","]), new Set(["and", "then"]));
}

function sequenceGroups(clause: Clause): Clause[] {
  return splitProtected(clause.text, clause.start, new Set(), new Set(["then"]));
}

const actionLexicon: { pattern: RegExp; kind: ActionKind; verb: string }[] = [
  { pattern: /\b(search|scrape|browse)\b/i, kind: "web_search", verb: "search" },
  { pattern: /\b(api|webhook)\b/i, kind: "api_call", verb: "call" },
  { pattern: /\b(query|retrieve|pull|knowledge base|database|db|crm)\b/i, kind: "knowledge_retrieval", verb: "retrieve" },
  { pattern: /\b(read|write|file|report|document|pdf|inspect)\b/i, kind: "file_operation", verb: "inspect" },
  { pattern: /\b(code|execute|script)\b/i, kind: "code_execution", verb: "execute" },
  { pattern: /\b(page|notify|send|publish|emit|slack|email|alert)\b/i, kind: "notification", verb: "notify" },
  { pattern: /\b(analyze|compose|draft|summarize|synthesi[sz]e|apply|transform|calculate|process|validate|check|fact-check)\b/i, kind: "reasoning", verb: "reason" },
];


function actionFor(segment: Clause): { label: string; kind: ActionKind; verb: string } | null {
  const item = actionLexicon.find(({ pattern }) => pattern.test(segment.text));
  if (!item) return null;
  const label = segment.text
    .replace(/\b(in parallel|simultaneously|at the same time|independently)\b/gi, "")
    .replace(/^\s*(and|then)\s+/i, "")
    .trim();
  return { label: label || `${item.verb} simulated step`, kind: item.kind, verb: item.verb };
}

function routerFor(group: Clause): RouterDescription | null {
  if (!/\b(if|only)\b/i.test(group.text)) return null;
  const displayCondition = group.text.match(/\b(?:if|only)\b[\s\S]*$/i)?.[0]
    .replace(/^only\s+/i, "")
    .replace(/^if\s+/i, "")
    .trim() ?? group.text;
  if (/\[[^\]]*(threshold|amount|score|value|volume)[^\]]*\]/i.test(displayCondition)) {
    return {
      label: displayCondition.slice(0, 180),
      condition: displayCondition.slice(0, 240),
      operand: "unsupported",
      operator: "default",
      conditionLabel: "Condition route",
      defaultLabel: "Default bypass",
    };
  }
  const numeric = displayCondition.match(/(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)/);
  if (numeric) {
    return {
      label: displayCondition.slice(0, 180),
      condition: displayCondition.slice(0, 240),
      operand: "fixture.numericValue",
      operator: numeric[1] as RouterOperator,
      comparisonValue: Number(numeric[2]),
      conditionLabel: "Condition met",
      defaultLabel: "Condition not met",
    };
  }
  if (/\b(flag|flagged|valid|approved|enabled|true|present|available)\b/i.test(displayCondition)) {
    return {
      label: displayCondition.slice(0, 180),
      condition: displayCondition.slice(0, 240),
      operand: "fixture.booleanFlag",
      operator: /\b(not|false|invalid|disabled)\b/i.test(displayCondition) ? "falsy" : "truthy",
      conditionLabel: "Condition met",
      defaultLabel: "Condition not met",
    };
  }
  return {
    label: displayCondition.slice(0, 180),
    condition: displayCondition.slice(0, 240),
    operand: "unsupported",
    operator: "default",
    conditionLabel: "Condition route",
    defaultLabel: "Default bypass",
  };
}

function compileGeneral(snapshot: string, normalized: string): ArchitectGraph {
  const { builder, input } = baseBuilder(snapshot, "Task input");
  const clauses = splitArchitectClauses(normalized);
  type Frontier = { node: ArchitectNode; sourceHandle?: string };
  let frontier: Frontier[] = [{ node: input }];
  let recognized = 0;
  let capped = false;
  for (const clause of clauses) {
    const groups = sequenceGroups(clause);
    const recognizedGroups = groups.map((group) => ({
      group,
      candidates: operationSegments(group)
        .map((segment) => ({ segment, action: actionFor(segment) })),
    }));
    for (const { group, candidates } of recognizedGroups) {
      const routerDescription = routerFor(group);
      for (const { segment, action } of candidates) {
        const conditionOnly = Boolean(routerDescription)
          && /^(?:if|only\s+if)\b/i.test(segment.text)
          && !action;
        if (!action && !conditionOnly) {
          builder.note("unmatched", `Unmatched segment: ${segment.text}`, segment.start, segment.end);
        }
      }
      const operations = candidates.filter((item) => item.action);
      if (!operations.length) {
        continue;
      }
      const explicitParallel = /\b(in parallel|simultaneously|at the same time|independently)\b/i.test(group.text);
      if (!explicitParallel && /\band\b/i.test(group.text) && operations.length > 1) {
        builder.note("ambiguous", "Plain conjunction kept sequential; only explicit parallel markers create fan-out.", group.start, group.end);
      }
      const forkCost = routerDescription && explicitParallel && operations.length > 1 ? 1 : 0;
      const structureCost = routerDescription ? 1 + forkCost : 0;
      const available = 12 - recognized - structureCost;
      if (available <= 0) {
        capped = true;
        continue;
      }
      const selected = operations.slice(0, available);
      if (selected.length < operations.length) capped = true;
      let conditionalDefault: Frontier | null = null;
      if (routerDescription) {
        const router = builder.addRouter(routerDescription);
        for (const previous of frontier) builder.connect(previous.node, router, previous.sourceHandle);
        const config = router.config as RouterConfig;
        frontier = [{ node: router, sourceHandle: config.conditionRouteId }];
        conditionalDefault = { node: router, sourceHandle: config.defaultRouteId };
        recognized += 1;
        if (routerDescription.operand === "unsupported") {
          builder.note(
            /\[[^\]]+\]/.test(routerDescription.condition) ? "placeholder" : "ambiguous",
            `Condition “${routerDescription.condition}” is unsupported; preview uses the named default route.`,
            group.start,
            group.end,
          );
        }
      }
      if (explicitParallel && selected.length > 1) {
        const branches = selected.map(({ action }) => builder.addAction(action!.label, action!.kind, action!.verb));
        if (conditionalDefault) {
          const fork = builder.addAction("Explicit parallel fork", "reasoning", "fork");
          builder.connect(frontier[0].node, fork, frontier[0].sourceHandle);
          for (const branch of branches) builder.connect(fork, branch);
          frontier = [...branches.map((node) => ({ node })), conditionalDefault];
          recognized += 1;
        } else {
          for (const previous of frontier) for (const branch of branches) builder.connect(previous.node, branch, previous.sourceHandle);
          frontier = branches.map((node) => ({ node }));
        }
        recognized += branches.length;
      } else {
        for (const { action } of selected) {
          const node = builder.addAction(action!.label, action!.kind, action!.verb);
          for (const previous of frontier) builder.connect(previous.node, node, previous.sourceHandle);
          frontier = [{ node }];
          recognized += 1;
        }
        if (conditionalDefault) frontier.push(conditionalDefault);
      }
    }
  }
  if (recognized === 0) {
    const labelSource = normalized.slice(0, 130);
    const unrecognized = builder.addAction(
      labelSource ? `Unrecognized simulated step: ${labelSource}` : "Unrecognized simulated step",
      "reasoning",
      "simulate",
    );
    const output = builder.addNode("output", "Task output");
    builder.connect(input, unrecognized);
    builder.connect(unrecognized, output);
    builder.note("unmatched", "No actionable capability was recognized");
    return builder.build();
  }
  if (capped) {
    const collapsed = builder.addAction("Collapsed overflow simulated steps", "reasoning", "collapse");
    for (const previous of frontier) builder.connect(previous.node, collapsed, previous.sourceHandle);
    frontier = [{ node: collapsed }];
    builder.note("node_cap", "Additional recognized steps were collapsed to keep the draft at 15 nodes or fewer.");
  }
  const output = builder.addNode("output", "Task output");
  for (const previous of frontier) builder.connect(previous.node, output, previous.sourceHandle);
  return builder.build();
}

export function buildFallbackGraph(descriptionSnapshot: string, reason = "The local compiler could not validate its draft."): ArchitectGraph {
  const snapshot = descriptionSnapshot.slice(0, 8_000);
  const { builder, input } = baseBuilder(snapshot, "Input");
  const simulated = builder.addAction("Simulated step", "reasoning", "simulate");
  const output = builder.addNode("output", "Output");
  builder.connect(input, simulated);
  builder.connect(simulated, output);
  builder.note("fallback", `Fallback draft: ${reason}`);
  const graph = builder.build("local_fallback");
  const validation = validateArchitectGraph(graph);
  if (!validation.valid) throw new Error(`Fallback graph is invalid: ${validation.errors.join(" ")}`);
  return graph;
}

export function compileDescription(description: string): ArchitectGraph {
  const snapshot = description.slice(0, 8_000);
  const normalized = snapshot.trim().replace(/\s+/g, " ");
  try {
    const template = ARCHITECT_TEMPLATES.find((candidate) => candidate.prompt === description);
    const graph = template ? presetCompilers[template.id](snapshot) : compileGeneral(snapshot, normalized);
    const validation = validateArchitectGraph(graph);
    if (!validation.valid) return buildFallbackGraph(snapshot, validation.errors.join(" "));
    return graph;
  } catch (error) {
    return buildFallbackGraph(snapshot, error instanceof Error ? error.message : "Unknown compiler error");
  }
}
