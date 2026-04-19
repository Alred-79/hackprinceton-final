import type { SimNode, SimEdge } from "@/types/simulator";

interface Answer {
  nodes: SimNode[];
  edges: SimEdge[];
}

const INCIDENT_REPORT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    severity: { type: "string", enum: ["P1-Critical", "P2-High", "P3-Medium", "P4-Low"] },
    title: { type: "string" },
    affected_systems: { type: "array", items: { type: "string" } },
    root_cause: { type: "string" },
    impact: { type: "string" },
    mitigation_steps: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["investigating", "identified", "mitigated", "resolved"] },
  },
  required: ["severity", "title", "affected_systems", "root_cause", "mitigation_steps"],
}, null, 2);

const THREAT_BRIEF_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    threat_id: { type: "string" },
    severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
    title: { type: "string" },
    indicators: { type: "array", items: { type: "string" } },
    affected_assets: { type: "array", items: { type: "string" } },
    attack_vector: { type: "string" },
    recommended_actions: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    data_gaps: { type: "array", items: { type: "string" } },
  },
  required: ["severity", "title", "indicators", "attack_vector", "recommended_actions", "confidence"],
}, null, 2);

const STANDARD_BRIEF_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "INFO"] },
    title: { type: "string" },
    indicators: { type: "array", items: { type: "string" } },
    attack_vector: { type: "string" },
    campaign_match: { type: "string" },
    recommended_actions: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["severity", "title", "indicators", "attack_vector", "recommended_actions", "confidence"],
}, null, 2);

const GAP_REPORT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    missing_feeds: { type: "array", items: { type: "string" } },
    missing_ioc_types: { type: "array", items: { type: "string" } },
    risk_assessment: { type: "string" },
    confidence_impact: { type: "string" },
    recommended_workarounds: { type: "array", items: { type: "string" } },
  },
  required: ["missing_feeds", "risk_assessment", "confidence_impact"],
}, null, 2);

const INVESTMENT_MEMO_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    company_overview: { type: "string" },
    financials: {
      type: "object",
      properties: {
        revenue: { type: "string" },
        growth_rate: { type: "string" },
        margins: { type: "string" },
        key_metrics: { type: "array", items: { type: "string" } },
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          description: { type: "string" },
          severity: { type: "string" },
        },
      },
    },
    team_assessment: { type: "string" },
    recommendation: { type: "string", enum: ["strong_buy", "buy", "hold", "pass"] },
    confidence_level: { type: "string", enum: ["high", "medium", "low"] },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["company_overview", "financials", "risks", "recommendation", "confidence_level"],
}, null, 2);

export const SCENARIO_ANSWERS: Record<string, Answer> = {
  // === BLOATED SWARM ===
  "bloated-swarm": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Customer Query" }, position: { x: 50, y: 250 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Query Classifier",
          model: "gemini-flash",
          routingPrompt: [
            "Classify the incoming customer support query into one of two categories:",
            "- 'complex': refunds, complaints, billing disputes, or anything requiring empathy and nuanced judgment",
            "- 'simple': shipping status, password resets, product info, general FAQ",
            "",
            "Respond with exactly one word: 'complex' or 'simple'.",
          ].join("\n"),
          routes: ["Complex", "Simple"],
        },
        position: { x: 280, y: 250 },
      },
      {
        id: "exec-complex", type: "executor",
        config: {
          label: "Complex Handler",
          model: "claude-sonnet",
          systemPrompt: "You are an expert customer support agent handling sensitive or complex issues (refunds, complaints, billing disputes). Be empathetic, follow company policy, and provide clear resolution steps. Always acknowledge the customer's frustration before proposing solutions. If a refund is warranted, explain the timeline. For complaints, offer concrete remediation.",
        },
        position: { x: 540, y: 140 },
      },
      {
        id: "exec-simple", type: "executor",
        config: {
          label: "Simple Handler",
          model: "gpt-4o-mini",
          systemPrompt: "You are a friendly customer support agent handling routine queries: shipping status lookups, password reset instructions, product information, and general FAQ. Be concise and helpful. Provide step-by-step instructions when relevant.",
        },
        position: { x: 540, y: 360 },
      },
      {
        id: "eval-1", type: "evaluator",
        config: {
          label: "Tone & Accuracy Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review this customer support response for professional tone, factual accuracy, and completeness. Does it address the customer's actual question?",
          passFailCriteria: "PASS if: response is polite, addresses the core issue, provides actionable next steps. FAIL if: rude tone, factually wrong, ignores the question, or missing critical information.",
        },
        position: { x: 780, y: 250 },
      },
      { id: "output-1", type: "output", config: { label: "Response" }, position: { x: 1000, y: 250 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "router-1" },
      { id: "e2", source: "router-1", target: "exec-complex", sourceHandle: "route-0" },
      { id: "e3", source: "router-1", target: "exec-simple", sourceHandle: "route-1" },
      { id: "e4", source: "exec-complex", target: "eval-1" },
      { id: "e5", source: "exec-simple", target: "eval-1" },
      { id: "e6", source: "eval-1", target: "output-1", sourceHandle: "pass" },
    ],
  },

  // === GOLD PLATER ===
  "gold-plater": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Task Input" }, position: { x: 50, y: 250 }, locked: true },
      {
        id: "exec-1", type: "executor",
        config: {
          label: "Classifier",
          model: "gpt-4o-mini",
          systemPrompt: "Classify the incoming task into one of these categories: 'formatting', 'analysis', or 'creative_writing'. Respond with just the category name.",
        },
        position: { x: 260, y: 250 },
      },
      {
        id: "exec-2", type: "executor",
        config: {
          label: "Formatter",
          model: "gpt-4o-mini",
          systemPrompt: "You are a text formatting specialist. Restructure the input according to formatting instructions. Apply consistent styling, fix spacing, organize into sections if needed. Output only the formatted result.",
        },
        position: { x: 480, y: 130 },
      },
      {
        id: "exec-3", type: "executor",
        config: {
          label: "Analyzer",
          model: "gpt-4o",
          systemPrompt: "You are an expert analyst. Examine the input data or text. Identify patterns, draw conclusions, compare alternatives, and provide well-reasoned analysis. Structure: Key Findings, Analysis, Recommendations.",
        },
        position: { x: 480, y: 370 },
      },
      {
        id: "eval-1", type: "evaluator",
        config: {
          label: "Quality Check",
          model: "claude-haiku",
          evaluationPrompt: "Review the output for accuracy, completeness, and appropriate formatting.",
          passFailCriteria: "PASS if: output is accurate, well-structured, and directly addresses the task. FAIL if: contains errors, is incomplete, or misunderstands the task requirements.",
        },
        position: { x: 700, y: 250 },
      },
      { id: "output-1", type: "output", config: { label: "Result" }, position: { x: 920, y: 250 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "exec-1" },
      { id: "e2", source: "exec-1", target: "exec-2" },
      { id: "e3", source: "exec-1", target: "exec-3" },
      { id: "e4", source: "exec-2", target: "eval-1" },
      { id: "e5", source: "exec-3", target: "eval-1" },
      { id: "e6", source: "eval-1", target: "output-1", sourceHandle: "pass" },
    ],
  },

  // === CONTENT MACHINE ===
  "content-machine": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Content Brief" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Format Router",
          model: "gpt-4o-mini",
          routingPrompt: "Classify the content request format: 'Blog' for articles/long-form, 'Social' for social media, 'Email' for campaigns. Respond with one word.",
          routes: ["Blog", "Social", "Email"],
        },
        position: { x: 250, y: 280 },
      },
      {
        id: "exec-blog", type: "executor",
        config: {
          label: "Blog Writer",
          model: "gemini-pro",
          systemPrompt: "You are an expert content marketer writing blog posts. Follow the brief's tone, audience, and topic requirements. Structure with: compelling headline, hook introduction, organized body with subheadings, actionable conclusion with CTA. Target 800-1200 words.",
        },
        position: { x: 480, y: 120 },
      },
      {
        id: "exec-social", type: "executor",
        config: {
          label: "Social Writer",
          model: "gpt-4o-mini",
          systemPrompt: "You are a social media content specialist. Create engaging posts tailored to the platform. Include relevant hashtags, keep within character limits, use hooks and CTAs. Provide 3 variations.",
        },
        position: { x: 480, y: 280 },
      },
      {
        id: "exec-email", type: "executor",
        config: {
          label: "Email Writer",
          model: "gemini-pro",
          systemPrompt: "You are an email marketing expert. Write compelling email copy with: attention-grabbing subject line (A/B options), personalized greeting, value-driven body, clear CTA button text, and P.S. line.",
        },
        position: { x: 480, y: 440 },
      },
      {
        id: "eval-brand", type: "evaluator",
        config: {
          label: "Brand Guidelines Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review the content against the original brief. Check brand voice consistency, target audience appropriateness, CTA presence, and overall quality.",
          passFailCriteria: "PASS if: matches brand tone, addresses target audience, includes CTA, is error-free. FAIL if: wrong tone, misses audience, no CTA, or grammatical errors.",
        },
        position: { x: 720, y: 280 },
      },
      {
        id: "gate-1", type: "context_gate",
        config: {
          label: "Revision Gate",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Pass forward: the evaluator's specific feedback and the original content brief. Discard the previous draft to avoid context bloat. The writer should create a fresh draft addressing the feedback.",
        },
        position: { x: 720, y: 460 },
      },
      { id: "output-1", type: "output", config: { label: "Final Content" }, position: { x: 960, y: 280 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "router-1" },
      { id: "e2", source: "router-1", target: "exec-blog", sourceHandle: "route-0" },
      { id: "e3", source: "router-1", target: "exec-social", sourceHandle: "route-1" },
      { id: "e4", source: "router-1", target: "exec-email", sourceHandle: "route-2" },
      { id: "e5", source: "exec-blog", target: "eval-brand" },
      { id: "e6", source: "exec-social", target: "eval-brand" },
      { id: "e7", source: "exec-email", target: "eval-brand" },
      { id: "e8", source: "eval-brand", target: "output-1", sourceHandle: "pass" },
      { id: "e9", source: "eval-brand", target: "gate-1", sourceHandle: "fail" },
      { id: "e10", source: "gate-1", target: "exec-blog" },
    ],
  },

  // === SAFETY NET ===
  "safety-net": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Doc Request" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "exec-prep", type: "executor",
        config: {
          label: "Request Parser",
          model: "gpt-4o-mini",
          systemPrompt: "Parse the document processing request. Extract the file reference(s), processing type (summarization, extraction, analysis), and specific requirements. Output structured JSON.",
        },
        position: { x: 250, y: 280 },
      },
      { id: "file-1", type: "file_rw", config: { label: "Document Reader" }, position: { x: 450, y: 280 } },
      { id: "fallback-1", type: "fallback_router", config: { label: "Read Status Check" }, position: { x: 640, y: 280 } },
      {
        id: "exec-process", type: "executor",
        config: {
          label: "Document Processor",
          model: "gpt-4o",
          systemPrompt: "You are a document processing specialist. Analyze the provided document content and perform the requested processing. Provide: Document Overview, Key Findings, Detailed Results, and Metadata.",
        },
        position: { x: 860, y: 160 },
      },
      {
        id: "exec-fallback", type: "executor",
        config: {
          label: "Graceful Fallback",
          model: "gpt-4o-mini",
          systemPrompt: "The document file could not be read. Provide a graceful fallback: acknowledge the failure, explain what was requested, suggest alternatives (retry, check path, provide manually), and summarize any partial data recovered.",
        },
        position: { x: 860, y: 400 },
      },
      { id: "output-1", type: "output", config: { label: "Processed Result" }, position: { x: 1100, y: 280 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "exec-prep" },
      { id: "e2", source: "exec-prep", target: "file-1" },
      { id: "e3", source: "file-1", target: "fallback-1" },
      { id: "e4", source: "fallback-1", target: "exec-process", sourceHandle: "success" },
      { id: "e5", source: "fallback-1", target: "exec-fallback", sourceHandle: "failure" },
      { id: "e6", source: "exec-process", target: "output-1" },
      { id: "e7", source: "exec-fallback", target: "output-1" },
    ],
  },

  // === MCP MIGRATION ===
  "mcp-migration": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Data Request" }, position: { x: 50, y: 240 }, locked: true },
      {
        id: "router-domain", type: "router",
        config: {
          label: "Domain Classifier",
          model: "gpt-4o-mini",
          routingPrompt: "Classify the request into one domain:\n- 'Research': needs web search, knowledge base lookups, or external API data retrieval\n- 'Data': needs file operations, code execution, or data processing\n\nRespond with one word.",
          routes: ["Research", "Data"],
        },
        position: { x: 260, y: 240 },
      },
      {
        id: "mcp-research", type: "mcp_server",
        config: {
          label: "Research MCP",
          servedTools: ["web_search", "tool_rag", "api_call"],
        },
        position: { x: 500, y: 120 },
      },
      {
        id: "mcp-data", type: "mcp_server",
        config: {
          label: "Data MCP",
          servedTools: ["file_rw", "code_exec"],
        },
        position: { x: 500, y: 360 },
      },
      {
        id: "exec-research", type: "executor",
        config: {
          label: "Research Agent",
          model: "gpt-4o",
          systemPrompt: "You are a research specialist. Use the Research MCP server (web search, knowledge base, and external APIs) to answer research queries. Synthesize findings across all sources, cite where data came from, and provide structured summaries with clear confidence levels.",
        },
        position: { x: 740, y: 120 },
      },
      {
        id: "exec-data", type: "executor",
        config: {
          label: "Data Agent",
          model: "gpt-4o",
          systemPrompt: "You are a data processing specialist. Use the Data MCP server (file contents and code execution) to process, analyze, and transform data. Output structured results with clear methodology, data lineage, and any anomalies found.",
        },
        position: { x: 740, y: 360 },
      },
      {
        id: "eval-quality", type: "evaluator",
        config: {
          label: "Quality Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review the output for completeness and accuracy. Does it address the original request? Is the data properly structured and sourced?",
          passFailCriteria: "PASS if: request fully addressed, output is structured, sources cited, accurate. FAIL if: incomplete, wrong domain, unsourced claims, or errors in output.",
        },
        position: { x: 960, y: 240 },
      },
      { id: "output-1", type: "output", config: { label: "Result" }, position: { x: 1180, y: 240 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "router-domain" },
      { id: "e2", source: "router-domain", target: "mcp-research", sourceHandle: "route-0" },
      { id: "e3", source: "router-domain", target: "mcp-data", sourceHandle: "route-1" },
      { id: "e4", source: "mcp-research", target: "exec-research" },
      { id: "e5", source: "mcp-data", target: "exec-data" },
      { id: "e6", source: "exec-research", target: "eval-quality" },
      { id: "e7", source: "exec-data", target: "eval-quality" },
      { id: "e8", source: "eval-quality", target: "output-1", sourceHandle: "pass" },
    ],
  },

  // === OPS CENTER — P1 Dispatch + P2 Context + P3 Schema + P4 Error + Human Review ===
  // Architecture: Fan-out → merge → route → fan-out (WIDE) + human sign-off on critical
  "ops-center": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Incident Alert" }, position: { x: 50, y: 300 }, locked: true },
      { id: "web-status", type: "web_search", config: { label: "Status Pages" }, position: { x: 280, y: 120 } },
      { id: "file-logs", type: "file_rw", config: { label: "System Logs" }, position: { x: 280, y: 300 } },
      { id: "rag-runbooks", type: "tool_rag", config: { label: "Runbooks", kValue: 5 }, position: { x: 280, y: 480 } },
      { id: "fallback-logs", type: "fallback_router", config: { label: "Log Status Check" }, position: { x: 480, y: 300 } },
      {
        id: "exec-log-fallback", type: "executor",
        config: {
          label: "Log Fallback",
          model: "gpt-4o-mini",
          systemPrompt: "System log retrieval failed or returned corrupted data. Acknowledge the gap: state which logs were unavailable, note what diagnostic info IS available from other sources, and recommend manual log retrieval steps for the on-call engineer. Do NOT guess at log contents.",
        },
        position: { x: 480, y: 480 },
      },
      {
        id: "gate-filter", type: "context_gate",
        config: {
          label: "Diagnostic Filter",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Extract ONLY: service health status (up/degraded/down), error patterns from logs (if available), relevant runbook procedures, and affected system names. Discard: raw HTML from status pages, full stack traces, duplicate log entries, and unrelated runbook sections.",
        },
        position: { x: 680, y: 300 },
      },
      {
        id: "router-severity", type: "router",
        config: {
          label: "Severity Classifier",
          model: "gpt-4o-mini",
          routingPrompt: "Based on the filtered diagnostic data, classify severity:\n- 'Critical': production down, data loss, security breach, multiple systems affected, customer-facing impact\n- 'Routine': single system degraded, non-production, known issue with runbook, or false positive\n\nConsider: customer impact, data risk, multi-system scope. Respond with one word.",
          routes: ["Critical", "Routine"],
        },
        position: { x: 880, y: 300 },
      },
      {
        id: "exec-critical", type: "executor",
        config: {
          label: "Critical Response",
          model: "gpt-4o",
          systemPrompt: "You are a senior incident commander writing a P1/P2 incident report. Identify the root cause (or hypothesis if incomplete data), list affected systems, provide mitigation steps in priority order, assess blast radius and customer impact. If log data was unavailable, note this gap. Be decisive and action-oriented.",
          outputSchema: INCIDENT_REPORT_SCHEMA,
        },
        position: { x: 1120, y: 140 },
      },
      {
        id: "human-signoff", type: "human_review",
        config: {
          label: "Incident Approval",
          reviewType: "approval",
        },
        position: { x: 1320, y: 140 },
      },
      {
        id: "exec-routine", type: "executor",
        config: {
          label: "Routine Response",
          model: "gpt-4o-mini",
          systemPrompt: "You are an operations assistant writing a routine incident report. Summarize the issue and likely cause, list affected systems, provide recommended actions or runbook references, and note if this matches a known pattern. Be clear and concise.",
          outputSchema: INCIDENT_REPORT_SCHEMA,
        },
        position: { x: 1120, y: 420 },
      },
      {
        id: "eval-completeness", type: "evaluator",
        config: {
          label: "Completeness Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review incident report for CONTENT quality (format enforced by schema). Does it identify a root cause? Are mitigation steps actionable? If data was missing, is the gap acknowledged?",
          passFailCriteria: "PASS if: root cause identified or gap noted, mitigation steps are specific, severity matches evidence. FAIL if: vague 'investigate further', generic mitigation, or severity mismatch.",
        },
        position: { x: 1320, y: 300 },
      },
      { id: "output-1", type: "output", config: { label: "Incident Report" }, position: { x: 1540, y: 300 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "web-status" },
      { id: "e2", source: "input-1", target: "file-logs" },
      { id: "e3", source: "input-1", target: "rag-runbooks" },
      { id: "e4", source: "file-logs", target: "fallback-logs" },
      { id: "e5", source: "fallback-logs", target: "gate-filter", sourceHandle: "success" },
      { id: "e6", source: "fallback-logs", target: "exec-log-fallback", sourceHandle: "failure" },
      { id: "e7", source: "exec-log-fallback", target: "gate-filter" },
      { id: "e8", source: "web-status", target: "gate-filter" },
      { id: "e9", source: "rag-runbooks", target: "gate-filter" },
      { id: "e10", source: "gate-filter", target: "router-severity" },
      { id: "e11", source: "router-severity", target: "exec-critical", sourceHandle: "route-0" },
      { id: "e12", source: "router-severity", target: "exec-routine", sourceHandle: "route-1" },
      { id: "e13", source: "exec-critical", target: "human-signoff" },
      { id: "e14", source: "human-signoff", target: "eval-completeness" },
      { id: "e15", source: "exec-routine", target: "eval-completeness" },
      { id: "e16", source: "eval-completeness", target: "output-1", sourceHandle: "pass" },
    ],
  },

  // === DUE DILIGENCE ENGINE — P2 Multi-stage + P3 Schema + P4 Error + Eval Loop + Human Review ===
  // Architecture: Plan → gather → gate → draft → evaluate → revise loop (DEEP) + human sign-off
  "due-diligence-engine": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Target Company" }, position: { x: 50, y: 320 }, locked: true },
      {
        id: "exec-planner", type: "executor",
        config: {
          label: "Research Planner",
          model: "gpt-4o-mini",
          systemPrompt: "You are a due diligence research planner. Decompose the acquisition analysis into: market research queries (financial data, news, SEC filings), legal document requests (contracts, compliance, litigation), and company knowledge lookups (prior memos, industry reports, competitors). Output a structured research plan.",
        },
        position: { x: 250, y: 320 },
      },
      { id: "web-market", type: "web_search", config: { label: "Market Research" }, position: { x: 480, y: 140 } },
      { id: "file-legal", type: "file_rw", config: { label: "Legal Documents" }, position: { x: 480, y: 320 } },
      { id: "rag-company", type: "tool_rag", config: { label: "Company Data", kValue: 8 }, position: { x: 480, y: 500 } },
      { id: "fallback-legal", type: "fallback_router", config: { label: "Legal Doc Check" }, position: { x: 680, y: 320 } },
      {
        id: "exec-gap-noter", type: "executor",
        config: {
          label: "Gap Noter",
          model: "gpt-4o-mini",
          systemPrompt: "Legal document retrieval failed. Flag what is missing: which documents were unavailable, what risks this gap creates for the due diligence, and recommended workarounds (manual request, public records, legal team follow-up). The memo writer will add appropriate caveats. Do NOT fabricate legal data.",
        },
        position: { x: 680, y: 500 },
      },
      {
        id: "gate-research", type: "context_gate",
        config: {
          label: "Research Filter",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Extract ONLY: key financial metrics (revenue, growth, margins, multiples), identified legal risks or gaps, competitive position summary, team highlights, and red flags. Discard: full SEC filing text, legal boilerplate, raw HTML, duplicates. Preserve gap noter warnings if legal docs were unavailable.",
        },
        position: { x: 900, y: 320 },
      },
      {
        id: "exec-memo", type: "executor",
        config: {
          label: "Memo Writer",
          model: "gpt-4o",
          systemPrompt: "You are a senior M&A analyst writing an investment memo following the output schema exactly. Every claim must cite specific data. If legal documents were unavailable, add caveats. Recommendation must be justified by financials and risk profile. Confidence level reflects data completeness. Be analytical, not promotional.",
          outputSchema: INVESTMENT_MEMO_SCHEMA,
        },
        position: { x: 1100, y: 320 },
      },
      {
        id: "eval-quality", type: "evaluator",
        config: {
          label: "Memo Quality Check",
          model: "gemini-pro",
          evaluationPrompt: "Review memo for analytical rigor: are claims data-backed, risks categorized, caveats for missing data present, recommendation justified, confidence appropriate?",
          passFailCriteria: "PASS if: data-backed claims, specific risks, caveats present, justified recommendation, appropriate confidence. FAIL if: generic claims, missing risks, no data-gap caveats, or contradictory recommendation.",
        },
        position: { x: 1300, y: 220 },
      },
      {
        id: "gate-revision", type: "context_gate",
        config: {
          label: "Revision Gate",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Strip the previous memo draft entirely. Pass ONLY: evaluator feedback (what failed and why) and the original filtered research brief. The memo writer starts fresh with guidance, not patching the old draft. This prevents context pollution across iterations.",
        },
        position: { x: 1300, y: 440 },
      },
      {
        id: "human-approval", type: "human_review",
        config: {
          label: "Partner Sign-off",
          reviewType: "approval",
        },
        position: { x: 1500, y: 220 },
      },
      { id: "output-1", type: "output", config: { label: "Investment Memo" }, position: { x: 1700, y: 320 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "exec-planner" },
      { id: "e2", source: "exec-planner", target: "web-market" },
      { id: "e3", source: "exec-planner", target: "file-legal" },
      { id: "e4", source: "exec-planner", target: "rag-company" },
      { id: "e5", source: "file-legal", target: "fallback-legal" },
      { id: "e6", source: "fallback-legal", target: "gate-research", sourceHandle: "success" },
      { id: "e7", source: "fallback-legal", target: "exec-gap-noter", sourceHandle: "failure" },
      { id: "e8", source: "exec-gap-noter", target: "gate-research" },
      { id: "e9", source: "web-market", target: "gate-research" },
      { id: "e10", source: "rag-company", target: "gate-research" },
      { id: "e11", source: "gate-research", target: "exec-memo" },
      { id: "e12", source: "exec-memo", target: "eval-quality" },
      { id: "e13", source: "eval-quality", target: "human-approval", sourceHandle: "pass" },
      { id: "e14", source: "eval-quality", target: "gate-revision", sourceHandle: "fail" },
      { id: "e15", source: "gate-revision", target: "exec-memo" },
      { id: "e16", source: "human-approval", target: "output-1" },
    ],
  },

  // === THREAT ANALYST — Showcase: MCP consolidation + error handling + context management + eval loop + human review + Kafka streaming ===
  "threat-analyst": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Threat Indicators" }, position: { x: 50, y: 320 }, locked: true },
      {
        id: "mcp-intel", type: "mcp_server",
        config: {
          label: "Intel MCP",
          servedTools: ["web_search", "tool_rag", "api_call"],
        },
        position: { x: 280, y: 120 },
      },
      { id: "file-feed", type: "file_rw", config: { label: "Threat Feed" }, position: { x: 280, y: 320 } },
      { id: "code-ioc", type: "code_exec", config: { label: "IOC Sandbox" }, position: { x: 280, y: 520 } },
      { id: "fallback-feed", type: "fallback_router", config: { label: "Feed Check" }, position: { x: 480, y: 320 } },
      {
        id: "exec-gap-noter", type: "executor",
        config: {
          label: "Gap Noter",
          model: "gpt-4o-mini",
          systemPrompt: "Threat feed ingestion failed or returned corrupted indicator data. Flag exactly which feeds were unavailable, what IOC types are missing (IPs, domains, hashes), the risk this gap creates for threat assessment, and recommended workarounds (manual feed check, alternative sources, STIX/TAXII fallback). Do NOT fabricate indicators.",
          outputSchema: GAP_REPORT_SCHEMA,
        },
        position: { x: 480, y: 520 },
      },
      {
        id: "gate-filter", type: "context_gate",
        config: {
          label: "Intel Filter",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Extract ONLY: confirmed IOCs (IPs, domains, hashes with source attribution), OSINT key findings, threat feed matches, sandbox analysis results, and gap noter warnings if feeds failed. Discard: raw HTML from OSINT searches, full feed dumps, duplicate indicators, irrelevant RAG chunks, and verbose code output.",
        },
        position: { x: 700, y: 320 },
      },
      {
        id: "router-severity", type: "router",
        config: {
          label: "Severity Classifier",
          model: "gemini-flash",
          routingPrompt: "Based on the filtered intelligence, classify threat severity:\n- 'Critical': active exploitation, zero-day, APT indicators, multiple confirmed IOCs, infrastructure targeting\n- 'Standard': known signatures, low-confidence singles, informational indicators, reconnaissance activity\n\nConsider: IOC confidence level, attack sophistication, asset exposure, active vs historical. Respond with one word.",
          routes: ["Critical", "Standard"],
        },
        position: { x: 900, y: 320 },
      },
      {
        id: "exec-critical", type: "executor",
        config: {
          label: "Critical Analyst",
          model: "gpt-4o",
          systemPrompt: "You are a senior threat intelligence analyst writing a CRITICAL severity threat brief following the output schema exactly. Every claim must cite specific IOCs with source attribution. Assess attack vector, map to MITRE ATT&CK if possible, list affected assets, and provide prioritized response actions. If feed data was unavailable, add explicit caveats about reduced confidence. Be decisive and actionable — SOC analysts need to act on this NOW.",
          outputSchema: THREAT_BRIEF_SCHEMA,
        },
        position: { x: 1120, y: 180 },
      },
      {
        id: "exec-standard", type: "executor",
        config: {
          label: "Standard Analyst",
          model: "gpt-4o-mini",
          systemPrompt: "You are a threat intelligence analyst writing a standard-severity threat brief. Summarize the indicators, assess likely attack vector, note if indicators match known campaigns, and provide monitoring recommendations. Keep it concise — this is informational, not urgent.",
          outputSchema: STANDARD_BRIEF_SCHEMA,
        },
        position: { x: 1120, y: 460 },
      },
      {
        id: "eval-quality", type: "evaluator",
        config: {
          label: "Brief Quality Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review the threat intelligence brief for analytical rigor. Are IOCs cited with sources? Is the attack vector assessment specific (not generic)? Are recommended actions prioritized and actionable? If data gaps exist, are caveats present?",
          passFailCriteria: "PASS if: IOCs sourced, attack vector specific, actions actionable, caveats for missing data present, confidence level appropriate. FAIL if: unsourced claims, generic 'monitor and investigate', missing gap caveats, or confidence contradicts evidence.",
        },
        position: { x: 1340, y: 320 },
      },
      {
        id: "gate-revision", type: "context_gate",
        config: {
          label: "Revision Gate",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Strip the previous brief draft entirely. Pass ONLY: evaluator feedback (what failed and why) and the original filtered intelligence brief from Gate #1. The analyst starts fresh with guidance, not patching the old draft. This prevents context pollution across revision iterations.",
        },
        position: { x: 1340, y: 520 },
      },
      {
        id: "human-review", type: "human_review",
        config: {
          label: "Analyst Sign-off",
          reviewType: "approval",
        },
        position: { x: 1540, y: 250 },
      },
      {
        id: "event-alert", type: "kafka_stream",
        config: { label: "Alert Dispatch" },
        position: { x: 1720, y: 320 },
      },
      { id: "output-1", type: "output", config: { label: "Threat Brief" }, position: { x: 1900, y: 320 }, locked: true },
    ],
    edges: [
      // Parallel intelligence gathering
      { id: "e1", source: "input-1", target: "mcp-intel" },
      { id: "e2", source: "input-1", target: "file-feed" },
      { id: "e3", source: "input-1", target: "code-ioc" },
      // Error handling on threat feed
      { id: "e4", source: "file-feed", target: "fallback-feed" },
      { id: "e5", source: "fallback-feed", target: "gate-filter", sourceHandle: "success" },
      { id: "e6", source: "fallback-feed", target: "exec-gap-noter", sourceHandle: "failure" },
      { id: "e7", source: "exec-gap-noter", target: "gate-filter" },
      // Merge into context filter
      { id: "e8", source: "mcp-intel", target: "gate-filter" },
      { id: "e9", source: "code-ioc", target: "gate-filter" },
      // Triage
      { id: "e10", source: "gate-filter", target: "router-severity" },
      // Severity routing
      { id: "e11", source: "router-severity", target: "exec-critical", sourceHandle: "route-0" },
      { id: "e12", source: "router-severity", target: "exec-standard", sourceHandle: "route-1" },
      // Quality check
      { id: "e13", source: "exec-critical", target: "eval-quality" },
      { id: "e14", source: "exec-standard", target: "eval-quality" },
      // Eval loop
      { id: "e15", source: "eval-quality", target: "human-review", sourceHandle: "pass" },
      { id: "e16", source: "eval-quality", target: "gate-revision", sourceHandle: "fail" },
      { id: "e17", source: "gate-revision", target: "exec-critical" },
      // Human gate + alert dispatch
      { id: "e18", source: "human-review", target: "event-alert" },
      { id: "e19", source: "event-alert", target: "output-1" },
    ],
  },
};
