
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert AI agent architect. Given a user's task description, you must:

1. Analyze the task and decompose it into an optimized multi-agent workflow using these available node types:
   - executor: An LLM call node. Has a model (pick from: gpt-4o, gpt-4o-mini, claude-sonnet, claude-haiku, gemini-pro, gemini-flash, claude-opus, o1-preview, o1-mini, gpt-4-turbo), a systemPrompt, and optionally an outputSchema (JSON schema string for structured output).
   - evaluator: Checks output quality. Has a model and evaluationCriteria string.
   - router: Routes to different paths based on input. Has a model and routes (string array of route names).
   - context_gate: Filters/compresses context. Has gateMode: "full_reset" or "structured_sendoff".
   - web_search: Searches the web. No config needed.
   - file_rw: Reads/writes files. No config needed.
   - tool_rag: Retrieves from knowledge base. Has kValue (1-10).
   - code_exec: Executes code. No config needed.
   - api_call: Makes API calls. Has endpointLabel string.
   - human_review: Human-in-the-loop checkpoint. Has approvalLabel string.
   - mcp_server: Tool aggregator. Has servedTools (array of tool type strings).
   - input: Entry point. Exactly one required.
   - output: Exit point. Exactly one required.

2. For each executor node, choose the CHEAPEST model that can handle the subtask. Don't use claude-opus or o1-preview unless the subtask genuinely requires frontier reasoning. Prefer gemini-flash/gpt-4o-mini for simple tasks, gemini-pro/gpt-4o for moderate tasks.

3. Use routing to skip unnecessary work (P1: dispatch, don't sequence).
4. Use context_gate nodes to manage context between stages (P2: context is a resource).
5. Use outputSchema on executors where structured output matters (P3: structural guarantees beat runtime checks).
6. Use fallback patterns and error handling at the source (P4: handle errors where they happen).
7. Parallelize independent tasks.

Return ONLY valid JSON with this exact structure:
{
  "summary": "One sentence describing the optimized workflow",
  "principlesApplied": ["P1: ...", "P2: ...", etc],
  "nodes": [
    {
      "id": "node-1",
      "type": "input",
      "label": "User Request",
      "config": {},
      "position": { "x": 0, "y": 0 }
    }
  ],
  "edges": [
    { "id": "e-1-2", "source": "node-1", "target": "node-2" }
  ],
  "metrics": {
    "estimatedCost": 2.5,
    "estimatedLatency": 4.2,
    "estimatedReliability": 87
  },
  "naive": {
    "model": "claude-opus",
    "estimatedCost": 15.0,
    "estimatedLatency": 8.0,
    "estimatedReliability": 45,
    "whyItFails": "Single model handles everything with no routing, no structured output, no error handling..."
  }
}

Position nodes in a readable left-to-right layout. x increases by ~250 per column, y staggers parallel nodes by ~120. Keep the total under 15 nodes. Every node must be connected. The graph must start with input and end with output.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const AI_API_TOKEN = Deno.env.get("AI_API_TOKEN_fb5ad316cb9a");
    if (!AI_API_TOKEN) {
      return new Response(
        JSON.stringify({ error: "AI API token not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'prompt' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://api.enter.pro/code/api/v1/ai/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        messages: [
          { role: "user", content: `Decompose this task into an optimized multi-agent workflow:\n\n${prompt}` },
        ],
        system: SYSTEM_PROMPT,
        stream: false,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);
      return new Response(
        JSON.stringify({ error: "AI service error", detail: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // Extract the text content from Claude's response
    const textContent = data.content?.find((c: { type: string }) => c.type === "text");
    if (!textContent?.text) {
      return new Response(
        JSON.stringify({ error: "No text response from AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the JSON from the response (handle markdown code blocks)
    let jsonStr = textContent.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const workflow = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify(workflow),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Decompose error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
