import type { SimNode, SimEdge } from "@/types/simulator";

interface Answer {
  nodes: SimNode[];
  edges: SimEdge[];
}

export const SCENARIO_ANSWERS: Record<string, Answer> = {
  // === Bloated Swarm ===
  // Consolidate 7 agents -> Router + 2 Executors (simple/complex)
  "bloated-swarm": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Customer Query" }, position: { x: 50, y: 250 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Query Classifier",
          model: "gemini-flash",
          routingPrompt: "Classify the incoming customer support query into one of two categories:\n- 'complex': refunds, complaints, billing disputes, or anything requiring empathy and nuanced judgment\n- 'simple': shipping status, password resets, product info, general FAQ\n\nRespond with exactly one word: 'complex' or 'simple'.",
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
          systemPrompt: "You are a friendly customer support agent handling routine queries: shipping status lookups, password reset instructions, product information, and general FAQ. Be concise and helpful. Provide step-by-step instructions when relevant. For shipping, ask for the order number if not provided.",
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

  // === Gold Plater ===
  // Right-size models: o1-preview -> appropriate tier per task
  "gold-plater": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Task Input" }, position: { x: 50, y: 250 }, locked: true },
      {
        id: "exec-1", type: "executor",
        config: {
          label: "Classifier",
          model: "gpt-4o-mini",
          systemPrompt: "Classify the incoming task into one of these categories: 'formatting', 'analysis', or 'creative_writing'. Respond with just the category name. Formatting = restructure/reformat text. Analysis = complex reasoning, data interpretation, comparisons. Creative writing = stories, marketing copy, original content.",
        },
        position: { x: 260, y: 250 },
      },
      {
        id: "exec-2", type: "executor",
        config: {
          label: "Formatter",
          model: "gpt-4o-mini",
          systemPrompt: "You are a text formatting specialist. Take the input and restructure it according to the formatting instructions. Apply consistent styling, fix spacing, organize into sections if needed. Output only the formatted result.",
        },
        position: { x: 480, y: 130 },
      },
      {
        id: "exec-3", type: "executor",
        config: {
          label: "Analyzer",
          model: "gpt-4o",
          systemPrompt: "You are an expert analyst. Carefully examine the input data or text. Identify patterns, draw conclusions, compare alternatives, and provide well-reasoned analysis. Structure your response with: Key Findings, Analysis, and Recommendations.",
        },
        position: { x: 480, y: 370 },
      },
      {
        id: "eval-1", type: "evaluator",
        config: {
          label: "Quality Check",
          model: "claude-haiku",
          evaluationPrompt: "Review the output for accuracy, completeness, and appropriate formatting. Does the response fully address the original task?",
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

  // === Triage Nurse ===
  // Router -> 3 urgency branches -> Safety Evaluator
  "triage-nurse": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Patient Symptoms" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Urgency Classifier",
          model: "gpt-4o-mini",
          routingPrompt: "You are a medical triage classifier. Based on the patient's symptom description, classify urgency:\n- 'Emergency': chest pain, difficulty breathing, severe bleeding, stroke symptoms, loss of consciousness\n- 'Urgent': high fever, moderate pain, infections, sprains, persistent symptoms\n- 'Routine': mild symptoms, follow-ups, general health questions, preventive care\n\nRespond with exactly one word.",
          routes: ["Emergency", "Urgent", "Routine"],
        },
        position: { x: 280, y: 280 },
      },
      {
        id: "exec-emergency", type: "executor",
        config: {
          label: "Emergency Handler",
          model: "gpt-4o",
          systemPrompt: "You are an emergency medical intake specialist. The patient has emergency-level symptoms. Provide:\n1. Immediate safety instructions (what to do RIGHT NOW)\n2. Whether to call emergency services (911)\n3. Critical information to tell the paramedics\n\nBe direct, clear, and prioritize life-saving steps. Include standard medical disclaimer.",
        },
        position: { x: 530, y: 100 },
      },
      {
        id: "exec-urgent", type: "executor",
        config: {
          label: "Urgent Care Handler",
          model: "gemini-pro",
          systemPrompt: "You are an urgent care medical assistant. Provide:\n1. Assessment of likely condition based on symptoms\n2. Recommended self-care steps\n3. When to seek in-person urgent care vs. schedule a doctor visit\n4. Warning signs that would escalate this to an emergency\n\nBe thorough but not alarmist. Include standard medical disclaimer.",
        },
        position: { x: 530, y: 280 },
      },
      {
        id: "exec-routine", type: "executor",
        config: {
          label: "Routine Care Handler",
          model: "gpt-4o-mini",
          systemPrompt: "You are a general health assistant handling routine medical questions. Provide:\n1. General guidance for the described symptoms\n2. Home remedies or OTC recommendations if applicable\n3. When to schedule a regular doctor appointment\n\nBe friendly and informative. Include standard medical disclaimer.",
        },
        position: { x: 530, y: 460 },
      },
      {
        id: "eval-safety", type: "evaluator",
        config: {
          label: "Medical Safety Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review this medical response for safety. Check: Does it include a medical disclaimer? Does it avoid diagnosing specific conditions? Does it recommend professional medical attention when appropriate? Could any advice be harmful?",
          passFailCriteria: "PASS if: includes disclaimer, does not diagnose, recommends seeing a doctor when appropriate, advice is safe. FAIL if: makes a specific diagnosis, recommends prescription medications, could cause harm, missing disclaimer.",
        },
        position: { x: 780, y: 280 },
      },
      { id: "output-1", type: "output", config: { label: "Medical Response" }, position: { x: 1020, y: 280 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "router-1" },
      { id: "e2", source: "router-1", target: "exec-emergency", sourceHandle: "route-0" },
      { id: "e3", source: "router-1", target: "exec-urgent", sourceHandle: "route-1" },
      { id: "e4", source: "router-1", target: "exec-routine", sourceHandle: "route-2" },
      { id: "e5", source: "exec-emergency", target: "eval-safety" },
      { id: "e6", source: "exec-urgent", target: "eval-safety" },
      { id: "e7", source: "exec-routine", target: "eval-safety" },
      { id: "e8", source: "eval-safety", target: "output-1", sourceHandle: "pass" },
    ],
  },

  // === Trading Floor ===
  // Parallel data gathering -> Context Gate -> Synthesis -> Evaluator
  "trading-floor": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Ticker & Request" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Data Splitter",
          model: "gemini-flash",
          routingPrompt: "Split this financial analysis request into three parallel data-gathering tasks. Always route to all three branches simultaneously: 'Web' for live market data, 'Files' for historical records, and 'RAG' for company fundamentals.",
          routes: ["Web", "Files", "RAG"],
        },
        position: { x: 250, y: 280 },
      },
      { id: "web-1", type: "web_search", config: { label: "Market Data Search" }, position: { x: 480, y: 100 } },
      { id: "file-1", type: "file_rw", config: { label: "Historical Records" }, position: { x: 480, y: 280 } },
      { id: "rag-1", type: "tool_rag", config: { label: "Company Fundamentals", kValue: 5 }, position: { x: 480, y: 460 } },
      {
        id: "gate-1", type: "context_gate",
        config: {
          label: "Data Filter",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Extract and pass forward: key financial metrics, recent price action, relevant news headlines, and fundamental ratios. Discard raw HTML, duplicate data, and irrelevant search results.",
        },
        position: { x: 700, y: 280 },
      },
      {
        id: "exec-synth", type: "executor",
        config: {
          label: "Synthesis & Recommendation",
          model: "gpt-4-turbo",
          systemPrompt: "You are a senior financial analyst. Synthesize the provided data from multiple sources into a trading recommendation. Structure your response:\n\n1. SUMMARY: 2-sentence overview\n2. BULL CASE: key positive factors\n3. BEAR CASE: key risk factors\n4. RECOMMENDATION: Buy/Hold/Sell with confidence level (Low/Medium/High)\n5. KEY METRICS: price targets, P/E ratio, growth rate\n\nBe data-driven. Cite specific numbers from the provided data.",
        },
        position: { x: 920, y: 280 },
      },
      { id: "output-1", type: "output", config: { label: "Trading Recommendation" }, position: { x: 1160, y: 280 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "router-1" },
      { id: "e2", source: "router-1", target: "web-1", sourceHandle: "route-0" },
      { id: "e3", source: "router-1", target: "file-1", sourceHandle: "route-1" },
      { id: "e4", source: "router-1", target: "rag-1", sourceHandle: "route-2" },
      { id: "e5", source: "web-1", target: "gate-1" },
      { id: "e6", source: "file-1", target: "gate-1" },
      { id: "e7", source: "rag-1", target: "gate-1" },
      { id: "e8", source: "gate-1", target: "exec-synth" },
      { id: "e9", source: "exec-synth", target: "output-1" },
    ],
  },

  // === Content Machine ===
  // Router -> Generator -> Evaluator (loop) with Context Gate
  "content-machine": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Content Brief" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "router-1", type: "router",
        config: {
          label: "Format Router",
          model: "gpt-4o-mini",
          routingPrompt: "Classify the content request format:\n- 'Blog': blog posts, articles, long-form content\n- 'Social': tweets, social media posts, short captions\n- 'Email': email campaigns, newsletters, drip sequences\n\nRespond with one word.",
          routes: ["Blog", "Social", "Email"],
        },
        position: { x: 250, y: 280 },
      },
      {
        id: "exec-blog", type: "executor",
        config: {
          label: "Blog Writer",
          model: "gemini-pro",
          systemPrompt: "You are an expert content marketer writing blog posts. Follow the brief's tone, audience, and topic requirements. Structure with: compelling headline, hook introduction, organized body with subheadings, actionable conclusion with CTA. Target 800-1200 words. Use the brand voice specified in the brief.",
        },
        position: { x: 480, y: 120 },
      },
      {
        id: "exec-social", type: "executor",
        config: {
          label: "Social Writer",
          model: "gpt-4o-mini",
          systemPrompt: "You are a social media content specialist. Create engaging, concise posts tailored to the platform. Include relevant hashtags, keep within character limits, use hooks and CTAs. Match the brand voice from the brief. Provide 3 variations.",
        },
        position: { x: 480, y: 280 },
      },
      {
        id: "exec-email", type: "executor",
        config: {
          label: "Email Writer",
          model: "gemini-pro",
          systemPrompt: "You are an email marketing expert. Write compelling email copy with: attention-grabbing subject line (A/B options), personalized greeting, value-driven body, clear CTA button text, and P.S. line. Follow the brief's audience and goals. Optimize for open rates and click-through.",
        },
        position: { x: 480, y: 440 },
      },
      {
        id: "eval-brand", type: "evaluator",
        config: {
          label: "Brand Guidelines Check",
          model: "gpt-4o-mini",
          evaluationPrompt: "Review the content against the original brief. Check brand voice consistency, target audience appropriateness, CTA presence, and overall quality.",
          passFailCriteria: "PASS if: matches brand tone, addresses target audience, includes CTA, is error-free, meets format requirements. FAIL if: wrong tone, misses audience, no CTA, grammatical errors, or doesn't match the requested format.",
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

  // === Safety Net ===
  // File R/W -> Fallback Router -> Success/Failure paths
  "safety-net": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Doc Request" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "exec-prep", type: "executor",
        config: {
          label: "Request Parser",
          model: "gpt-4o-mini",
          systemPrompt: "Parse the document processing request. Extract the file reference(s), the type of processing needed (summarization, extraction, analysis), and any specific requirements. Output a structured JSON with fields: files, processing_type, requirements.",
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
          systemPrompt: "You are a document processing specialist. Analyze the provided document content and perform the requested processing (summarization, extraction, or analysis). Provide a well-structured output with:\n1. Document Overview\n2. Key Findings\n3. Detailed Results\n4. Metadata (word count, key entities, dates found)",
        },
        position: { x: 860, y: 160 },
      },
      {
        id: "exec-fallback", type: "executor",
        config: {
          label: "Graceful Fallback",
          model: "gpt-4o-mini",
          systemPrompt: "The document file could not be read (corrupted or unavailable). Provide a graceful fallback response:\n1. Acknowledge the file read failure\n2. Explain what processing was requested\n3. Suggest alternative actions (retry later, check file path, provide file manually)\n4. If any partial data was recovered, summarize what's available.",
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

  // === Full Stack Agent ===
  // Parallel web+RAG -> Context Gate -> Writer -> Evaluator
  "full-stack-agent": {
    nodes: [
      { id: "input-1", type: "input", config: { label: "Research Question" }, position: { x: 50, y: 280 }, locked: true },
      {
        id: "exec-planner", type: "executor",
        config: {
          label: "Research Planner",
          model: "gpt-4o-mini",
          systemPrompt: "You are a research planning assistant. Break down the research question into:\n1. Key search queries (2-3 specific queries for web search)\n2. Knowledge base topics to look up\n3. Scope boundaries (what to include/exclude)\n4. Expected structure of the final report\n\nOutput a structured plan.",
        },
        position: { x: 250, y: 280 },
      },
      { id: "web-1", type: "web_search", config: { label: "Web Research" }, position: { x: 480, y: 150 } },
      { id: "rag-1", type: "tool_rag", config: { label: "Knowledge Base", kValue: 8 }, position: { x: 480, y: 410 } },
      {
        id: "gate-1", type: "context_gate",
        config: {
          label: "Research Filter",
          contextGateMode: "structured_sendoff",
          handoffBrief: "Extract and organize: key facts with source citations, relevant statistics, expert quotes, and counterarguments. Discard duplicate information, irrelevant search results, and boilerplate text. Group by theme/subtopic.",
        },
        position: { x: 700, y: 280 },
      },
      {
        id: "exec-writer", type: "executor",
        config: {
          label: "Report Writer",
          model: "gpt-4-turbo",
          systemPrompt: "You are a senior research analyst writing a structured report. Using the filtered research data, produce a comprehensive report with:\n\n1. EXECUTIVE SUMMARY (2-3 sentences)\n2. BACKGROUND & CONTEXT\n3. KEY FINDINGS (organized by theme)\n4. ANALYSIS & IMPLICATIONS\n5. LIMITATIONS & GAPS\n6. CONCLUSION & RECOMMENDATIONS\n7. SOURCES (cite all data sources)\n\nBe analytical, not just descriptive. Draw connections between findings.",
        },
        position: { x: 920, y: 280 },
      },
      {
        id: "eval-quality", type: "evaluator",
        config: {
          label: "Report Quality Review",
          model: "claude-sonnet",
          evaluationPrompt: "Review this research report for completeness, accuracy, proper citations, logical structure, and whether it answers the original research question.",
          passFailCriteria: "PASS if: answers the research question, has proper structure with all sections, cites sources, analysis is logical and well-supported. FAIL if: doesn't answer the question, missing sections, no citations, or analysis has logical flaws.",
        },
        position: { x: 1140, y: 280 },
      },
      { id: "output-1", type: "output", config: { label: "Research Report" }, position: { x: 1380, y: 280 }, locked: true },
    ],
    edges: [
      { id: "e1", source: "input-1", target: "exec-planner" },
      { id: "e2", source: "exec-planner", target: "web-1" },
      { id: "e3", source: "exec-planner", target: "rag-1" },
      { id: "e4", source: "web-1", target: "gate-1" },
      { id: "e5", source: "rag-1", target: "gate-1" },
      { id: "e6", source: "gate-1", target: "exec-writer" },
      { id: "e7", source: "exec-writer", target: "eval-quality" },
      { id: "e8", source: "eval-quality", target: "output-1", sourceHandle: "pass" },
    ],
  },
};
