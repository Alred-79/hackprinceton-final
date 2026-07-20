import { z } from "zod";
import { ARCHITECT_NODE_LIMIT } from "./types";

const boundedId = z.string().min(1).max(120);
const boundedLabel = z.string().min(1).max(180);
const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const inputConfigSchema = z.object({ type: z.literal("input") }).strict();
const outputConfigSchema = z.object({ type: z.literal("output") }).strict();
const actionConfigSchema = z.object({
  type: z.literal("action"),
  actionKind: z.enum([
    "reasoning",
    "web_search",
    "file_operation",
    "knowledge_retrieval",
    "code_execution",
    "api_call",
    "notification",
  ]),
  operationVerb: z.string().min(1).max(80),
  simulated: z.literal(true),
}).strict();
const evaluatorConfigSchema = z.object({
  type: z.literal("evaluator"),
  criterion: z.string().min(1).max(240),
}).strict();
const humanReviewConfigSchema = z.object({
  type: z.literal("human_review"),
  instruction: z.string().min(1).max(240),
}).strict();
const boundedStringList = z.array(z.string().min(1).max(120)).max(24)
  .refine((values) => new Set(values).size === values.length, "List values must be unique.");
const schemaGateConfigSchema = z.object({
  type: z.literal("schema_gate"),
  contractName: z.string().min(1).max(120),
  mode: z.enum(["strict", "strip_unknown"]),
  requiredFields: boundedStringList,
  violationBehavior: z.enum(["stop", "review"]),
}).strict();
const contextGateConfigSchema = z.object({
  type: z.literal("context_gate"),
  tokenCap: z.number().int().min(128).max(32_768),
  strategy: z.enum(["select", "summarize", "truncate"]),
  allowedSources: boundedStringList,
  blockedFields: boundedStringList,
}).strict();
const routeSchema = z.object({
  id: boundedId,
  label: boundedLabel,
  role: z.enum(["condition", "default"]),
}).strict();
const routerConfigSchema = z.object({
  type: z.literal("router"),
  displayCondition: z.string().min(1).max(240),
  operand: z.enum(["fixture.numericValue", "fixture.booleanFlag", "unsupported"]),
  operator: z.enum([">", ">=", "<", "<=", "==", "!=", "truthy", "falsy", "default"]),
  comparisonValue: z.union([z.number().finite(), z.boolean(), z.string().max(120)]).optional(),
  routes: z.tuple([routeSchema, routeSchema]),
  conditionRouteId: boundedId,
  defaultRouteId: boundedId,
}).strict();

export const architectNodeSchema = z.object({
  id: boundedId,
  kind: z.enum(["input", "output", "action", "router", "evaluator", "human_review", "schema_gate", "context_gate"]),
  label: boundedLabel,
  config: z.discriminatedUnion("type", [
    inputConfigSchema,
    outputConfigSchema,
    actionConfigSchema,
    routerConfigSchema,
    evaluatorConfigSchema,
    humanReviewConfigSchema,
    schemaGateConfigSchema,
    contextGateConfigSchema,
  ]),
  position: positionSchema,
}).strict().superRefine((node, ctx) => {
  if (node.kind !== node.config.type) {
    ctx.addIssue({ code: "custom", message: "Node kind must match its config variant." });
  }
});

export const architectEdgeSchema = z.object({
  id: boundedId,
  source: boundedId,
  target: boundedId,
  sourceHandle: boundedId.optional(),
  targetHandle: boundedId.optional(),
}).strict();

export const extractionNoteSchema = z.object({
  id: boundedId,
  kind: z.enum(["unmatched", "ambiguous", "placeholder", "node_cap", "fallback"]),
  message: z.string().min(1).max(500),
  sourceStart: z.number().int().nonnegative().optional(),
  sourceEnd: z.number().int().nonnegative().optional(),
}).strict();

export const architectGraphSchema = z.object({
  schemaVersion: z.literal("architect.graph.v1"),
  lexiconVersion: z.literal("architect.lexicon.v1"),
  descriptionSnapshot: z.string().max(8_000),
  nodes: z.array(architectNodeSchema).min(3).max(ARCHITECT_NODE_LIMIT),
  edges: z.array(architectEdgeSchema).min(2).max(80),
  extractionNotes: z.array(extractionNoteSchema).max(80),
  origin: z.enum(["local", "local_fallback"]),
}).strict();
