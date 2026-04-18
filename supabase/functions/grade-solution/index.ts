
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const AI_API_TOKEN = Deno.env.get("AI_API_TOKEN_fb5ad316cb9a");
    if (!AI_API_TOKEN) {
      throw new Error("AI_API_TOKEN is not configured");
    }

    const body = await req.json();
    const {
      scenarioId,
      scenarioBrief,
      scenarioDescription,
      expectedInputs,
      expectedOutputs,
      graph,
      deterministicResults,
    } = body;

    const systemPrompt = `You are an expert AI systems architect evaluating a student's agent architecture design.

SCENARIO CONTEXT:
${scenarioBrief}
${scenarioDescription}

Expected inputs: ${expectedInputs}
Expected outputs: ${expectedOutputs}

STUDENT'S ARCHITECTURE:
${JSON.stringify(graph, null, 2)}

DETERMINISTIC SCORES (already calculated):
Cost: $${deterministicResults.cost}, Latency: ${deterministicResults.latency}s, Reliability: ${deterministicResults.reliability}%

YOUR EVALUATION TASK:
Evaluate the student's solution on four dimensions:

1. PROMPT QUALITY (per node):
   For each Brain node (executor, evaluator, router), evaluate whether the system/evaluation/routing prompt:
   - Clearly defines the node's role and expected behavior
   - Includes output format instructions (if applicable)
   - Contains appropriate constraints and guardrails
   - Is appropriate for the selected model's capability level
   Score each 0-100 and provide specific, constructive feedback.

2. ARCHITECTURE REASONING (overall):
   Evaluate whether the overall architecture:
   - Uses an appropriate pattern for the scenario (dispatch vs pipeline vs parallel)
   - Selects models appropriate to task complexity at each step
   - Avoids unnecessary complexity (extra nodes that don't add value)
   - Handles the scenario's specific constraints effectively
   Score 0-100 with specific suggestions.

3. CONTEXT MANAGEMENT:
   For each Context Gate node, evaluate:
   - Is the mode (Full Reset vs Structured Sendoff) appropriate for this boundary?
   - If Structured Sendoff: does the handoff brief specify what to pass and what to exclude?
   - Are there missing context gates where one should exist?

4. EVALUATOR CRITERIA:
   For each Evaluator node, assess:
   - Does the Pass/Fail Criteria define concrete, measurable conditions?
   - Are the criteria relevant to the scenario's quality requirements?
   - Would these criteria actually catch the errors this scenario cares about?

Respond in VALID JSON format exactly matching this structure. Be constructive but honest.
Do NOT be lenient - a weak prompt should score below 40.
An empty prompt should score 0.

{
  "overall": {
    "pass": boolean,
    "architectureScore": number (0-100),
    "promptScore": number (0-100, average of per-node scores),
    "feedback": "2-3 sentence overall assessment",
    "suggestions": ["specific actionable improvement 1", "improvement 2"]
  },
  "perNode": [
    {
      "nodeId": "node-id",
      "promptScore": number (0-100),
      "feedback": "specific feedback for this node",
      "issues": ["specific problem 1"]
    }
  ],
  "contextManagement": {
    "score": number (0-100),
    "feedback": "assessment of context gate usage",
    "gateDecisions": [
      {
        "gateNodeId": "gate-id",
        "modeChosen": "full_reset or structured_sendoff",
        "appropriate": boolean,
        "reason": "why this mode is/isn't appropriate"
      }
    ]
  },
  "evaluatorQuality": {
    "score": number (0-100),
    "criteriaAssessments": [
      {
        "evaluatorNodeId": "eval-id",
        "criteriaQuality": "strong|adequate|weak|empty",
        "feedback": "assessment of criteria quality"
      }
    ]
  }
}`;

    const response = await fetch("https://api.enter.pro/code/api/v1/ai/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        messages: [
          {
            role: "user",
            content: systemPrompt,
          },
        ],
        stream: false,
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);
      return new Response(
        JSON.stringify({ error: "AI evaluation failed", details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();

    // Extract text content from response
    let textContent = "";
    if (aiResponse.content && Array.isArray(aiResponse.content)) {
      for (const block of aiResponse.content) {
        if (block.type === "text") {
          textContent += block.text;
        }
      }
    }

    // Parse JSON from the AI response
    // Try to extract JSON from markdown code blocks or raw text
    let parsedResult;
    try {
      // Try direct parse first
      parsedResult = JSON.parse(textContent);
    } catch {
      // Try to extract from code block
      const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object in text
        const braceStart = textContent.indexOf("{");
        const braceEnd = textContent.lastIndexOf("}");
        if (braceStart !== -1 && braceEnd !== -1) {
          parsedResult = JSON.parse(textContent.slice(braceStart, braceEnd + 1));
        } else {
          throw new Error("Could not parse AI response as JSON");
        }
      }
    }

    return new Response(JSON.stringify(parsedResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Grade solution error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Evaluation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
