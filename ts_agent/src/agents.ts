import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import {
  IntentSchema,
  ClarificationSchema,
  ClarificationState,
  ResearchPlan,
  ResearchPlanSchema,
  PlanStep,
  StepResult,
  UncertaintyDecisionSchema,
  EvidenceSufficiencyDecisionSchema,
  DebateArgumentSchema,
  JudgeVerdictSchema,
  StepResultSchema,
  PlanStepSchema,
  ClarificationStateSchema,
} from "./schemas.js";
import { AgentState } from "./state.js";
import { geminiFlash, claudeSonnet, o3Mini } from "./llm.js";
import { invokeStructured } from "./utils.js";
import { toolRegistry } from "./tools.js";
import { buildCredibilityReport } from "./credibility.js";

// Structured output wrappers
const intentParser = geminiFlash.withStructuredOutput(IntentSchema, { name: "IntentSchema" });
const clarificationGenerator = geminiFlash.withStructuredOutput(ClarificationSchema, { name: "ClarificationSchema" });
const stepEvaluator = geminiFlash.withStructuredOutput(UncertaintyDecisionSchema, { name: "UncertaintyDecision" });
const evidenceEvaluator = claudeSonnet.withStructuredOutput(EvidenceSufficiencyDecisionSchema, { name: "EvidenceSufficiencyDecision" });
const optimist = o3Mini.withStructuredOutput(DebateArgumentSchema, { name: "DebateArgument" });
const skeptic = claudeSonnet.withStructuredOutput(DebateArgumentSchema, { name: "DebateArgument" });
const judge = claudeSonnet.withStructuredOutput(JudgeVerdictSchema, { name: "JudgeVerdict" });

// ── SYSTEM PROMPTS ────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `
You are an intent extraction engine for a research assistant.

Given a user query, extract:
1. location — the geographic location the user is asking about. Fully resolve abbreviations
   (NYC -> New York, NY). Empty string if no location is mentioned.
2. topics — a list of research topics. Do not limit to weather/news. Use your judgment:
   - "Should I go to the concert?" -> ["weather", "local_events"]
   - "Is it safe to drive?" -> ["weather", "traffic", "road_conditions"]
   - "What's the situation?" -> flag as ambiguous
3. time_range — temporal scope: "now", "today", "tonight", "this_week", "unspecified"
4. is_ambiguous — True only when multiple distinct interpretations would lead to
   meaningfully different research plans. "What's the weather?" is NOT ambiguous even
   without a location (location is simply missing, which is handled separately).
5. ambiguity_reason — required when is_ambiguous=True. One sentence.

Be conservative with is_ambiguous=True. Only flag genuine semantic ambiguity,
not missing information.

Format: You MUST call the "IntentSchema" function exactly as defined. Do NOT prepend namespaces (e.g. "default_api.") and do NOT wrap the function call in code execution or Python syntax (e.g. print()).
`;

const CLARIFICATION_SYSTEM_PROMPT = `
You are a clarification agent. The user's query is ambiguous in a specific way.
Generate exactly ONE targeted question that, when answered, fully resolves the ambiguity.
Do not ask multiple questions. Do not ask for information you can infer.
The question must be answerable in one or two sentences.

Format: You MUST call the "ClarificationSchema" function exactly as defined. Do NOT prepend namespaces (e.g. "default_api.") and do NOT wrap the function call in code execution or Python syntax (e.g. print()).
`;

const STEP_EVALUATOR_PROMPT = `
You are a research quality evaluator.

Given:
- The user's original query
- The research step that was just executed (tool, query, rationale)  
- The raw result returned by the tool

Evaluate the result and decide:
- accept: The result adequately addresses this step's rationale. Confidence >= 0.6.
- retry: The result is incomplete, off-topic, or low quality. Provide an amended_query.
- escalate: The result reveals we need more information from the user to proceed.

Be honest about result quality. Do not accept thin or irrelevant results.

Format: You MUST call the "UncertaintyDecision" function exactly as defined. Do NOT prepend namespaces (e.g. "default_api.") and do NOT wrap the function call in code execution or Python syntax (e.g. print()).
`;

const EVIDENCE_EVALUATOR_PROMPT = `
You are a research completeness auditor.

Given:
- The user's original query
- All collected research results with their credibility scores
- The original research plan

Evaluate: Is the evidence collected sufficient to give a reliable, complete answer?

Consider:
1. Are all topics from the parsed intent covered by at least one high-quality result?
2. Are there contradictions between results that remain unresolved?
3. Are there obvious gaps that a simple additional search could fill?
4. Is the overall confidence of the evidence set adequate (average >= 0.5)?

Decision options:
- proceed: Evidence is sufficient. Go to synthesis.
- augment: A specific gap exists that warrants 1-2 additional searches.
            Provide the augmentation_steps (max 2 new steps).
- proceed_with_caveats: Evidence is thin but additional searches are unlikely to help.
                        Note the gaps explicitly — the judge will flag them.
`;

const OPTIMIST_SYSTEM_PROMPT = `
You are the Optimist in a research debate. Your role is to argue the most
well-supported, complete interpretation of the evidence collected.

Rules:
- Cite specific step_ids as evidence for every claim
- Acknowledge limitations, but emphasize what IS known
- Do not fabricate data not present in the evidence
- Focus on what gives the user actionable confidence

Your argument will be reviewed by a Skeptic. Be precise so the Skeptic
can engage with specific claims rather than generalities.
`;

const SKEPTIC_SYSTEM_PROMPT = `
You are the Skeptic in a research debate. The Optimist has made an argument.
Your role is to rigorously challenge it.

Your attack vectors:
1. Credibility attacks: Point to low-authority or stale sources cited as evidence
2. Contradiction attacks: Identify claims that are contradicted by other results
3. Gap attacks: Identify what is NOT known that undermines the Optimist's confidence
4. Relevance attacks: Challenge whether cited evidence actually supports the claim

Rules:
- Reference specific step_ids when challenging evidence
- Be rigorous, not pedantic — only raise substantive issues
- Your goal is calibration, not demolition. Acknowledge what IS solid.
- Your argument will be read by a Judge who values precision.
`;

const JUDGE_SYSTEM_PROMPT = `
You are the Judge in a research debate. You have read:
- The collected evidence with credibility scores
- The Optimist's argument (most favorable interpretation)
- The Skeptic's challenges and counterpoints

Your job is to produce a calibrated, honest final answer.

Rules:
1. Weight evidence by credibility scores — high-authority, recent sources take precedence
2. Acknowledge what the Skeptic correctly identified as uncertain
3. Flag specific claims in your answer that the user should treat with caution
4. Be direct — the user wants an answer, not a dissertation
5. If contradictions between sources remain unresolved, say so explicitly
6. Your confidence score must reflect the actual quality of the evidence, not
   your desire to sound definitive

Format: The answer field should be readable by a non-expert. Use markdown.
`;

// ── PLANNER PROMPT ────────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `
You are a research planner for an information retrieval system.

Available tools:
- weather_search(query, location): Retrieves current conditions, forecasts, alerts
- news_search(query, location): Retrieves recent news articles (last 48h)
- web_search(query, location): General-purpose web search for anything else

Given a parsed user intent, generate a concrete research plan.
Rules:
1. Each step must use exactly one tool.
2. Steps should be ordered so that dependent information comes first.
3. Do not generate redundant steps. If weather_search covers the need, don't add web_search for the same.
4. Maximum 4 steps per plan. Force yourself to be efficient.
5. Each query must be specific — not "weather" but "Austin TX weather tonight outdoor safety".

Think step by step before generating the plan.
`;

// Helper: formats evidence for debate
function formatEvidenceForDebate(stepResults: StepResult[]): string {
  const sections: string[] = [];
  for (const result of stepResults) {
    const cred = result.credibility && result.credibility[0] ? result.credibility[0] : null;
    let credNote = "";
    if (cred) {
      const avg = (cred.trust_score + cred.recency_score + cred.relevance_score) / 3;
      credNote = ` [credibility: ${avg.toFixed(2)}, source: ${cred.source}]`;
    }

    sections.push(
      `[${result.step_id}]${credNote}\n` +
      `Quality: ${result.evidence_quality} | Confidence: ${result.confidence.toFixed(2)}\n` +
      `${result.raw_data.slice(0, 500)}`
    );
  }
  return sections.join("\n\n---\n\n");
}

// ── NODE FUNCTIONS ────────────────────────────────────────────────────────

export async function intentParserNode(state: AgentState): Promise<Partial<AgentState>> {
  const messages = state.messages;
  let userMessage = messages.length > 0 ? messages[messages.length - 1].content : "";

  const clarification = state.clarification;
  if (clarification && !clarification.awaiting_response && clarification.user_answer) {
    userMessage = `Original query: ${messages[0].content}\nClarification: ${clarification.user_answer}`;
  }

  const result = await invokeStructured(
    intentParser,
    [
      new SystemMessage({ content: INTENT_SYSTEM_PROMPT }),
      new HumanMessage({ content: typeof userMessage === "string" ? userMessage : JSON.stringify(userMessage) }),
    ],
    IntentSchema
  );

  return {
    parsed_query: result,
    clarification: null, // Reset — will be set again if still ambiguous
  };
}

export async function generateClarificationNode(state: AgentState): Promise<Partial<AgentState>> {
  const parsed = state.parsed_query;
  const userMessage = state.messages[0].content;

  const result = await invokeStructured(
    clarificationGenerator,
    [
      new SystemMessage({ content: CLARIFICATION_SYSTEM_PROMPT }),
      new HumanMessage({
        content: `User query: ${userMessage}\nDetected ambiguity: ${parsed.ambiguity_reason || ""}`,
      }),
    ],
    ClarificationSchema
  );

  const clarification: ClarificationState = {
    question: result.question,
    awaiting_response: true,
    user_answer: undefined,
  };

  return {
    clarification,
  };
}

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const parsed = state.parsed_query;
  const context = `Location: ${parsed.location || "not specified"}
Topics: ${(parsed.topics || []).join(", ")}
Time range: ${parsed.time_range || "unspecified"}
Original query: ${state.messages[0].content}`;

  const plan = await invokeStructured(
    o3Mini.withStructuredOutput(ResearchPlanSchema, { name: "ResearchPlan" }),
    [
      new SystemMessage({ content: PLANNER_SYSTEM_PROMPT }),
      new HumanMessage({ content: context }),
    ],
    ResearchPlanSchema
  );

  const retryCounts: Record<string, number> = {};
  for (const step of plan.steps) {
    retryCounts[step.step_id] = 0;
  }

  return {
    research_plan: {
      ...plan,
      current_step_idx: plan.current_step_idx ?? 0,
    },
    retry_counts: retryCounts,
  };
}

export async function executorNode(state: AgentState): Promise<Partial<AgentState>> {
  const plan = state.research_plan;
  if (!plan) {
    return {};
  }

  const currentStepIdx = plan.current_step_idx;
  if (currentStepIdx >= plan.steps.length) {
    return {};
  }

  const currentStep = plan.steps[currentStepIdx];
  console.log(`\n   -> [executor] Executing step: ${currentStep.tool}('${currentStep.query}')...`);

  const toolFn = toolRegistry[currentStep.tool];
  let rawData = "";

  if (!toolFn) {
    rawData = `Unknown tool: ${currentStep.tool}`;
  } else {
    try {
      rawData = await toolFn.invoke({
        query: currentStep.query,
        location: currentStep.location,
      });
    } catch (e: any) {
      rawData = `Error executing tool: ${e.message || String(e)}`;
    }
  }

  console.log(`        Done. Evaluating result quality...`);

  const evalContext = `Original query: ${state.messages[0].content}
Step rationale: ${currentStep.rationale}
Tool used: ${currentStep.tool}
Search query: ${currentStep.query}
Result:
${rawData}`;

  const decision = await invokeStructured(
    stepEvaluator,
    [
      new SystemMessage({ content: STEP_EVALUATOR_PROMPT }),
      new HumanMessage({ content: evalContext }),
    ],
    UncertaintyDecisionSchema
  );

  console.log(`        Decision: ${decision.action.toUpperCase()}`);

  const retryCounts = { ...state.retry_counts };
  const retryCount = retryCounts[currentStep.step_id] || 0;

  if (decision.action === "retry" && retryCount < 2) {
    plan.steps[currentStepIdx].query = decision.amended_query || currentStep.query;
    retryCounts[currentStep.step_id] = retryCount + 1;

    return {
      research_plan: plan,
      retry_counts: retryCounts,
    };
  }

  // Accept or escalate (advance plan, log step result)
  const stepResult: StepResult = {
    step_id: currentStep.step_id,
    tool: currentStep.tool,
    raw_data: rawData,
    confidence: decision.action === "retry" ? 0.3 : 0.8,
    evidence_quality: decision.action === "retry" ? "low" : "medium",
    gaps: [],
    credibility: undefined,
  };

  const updatedPlan = {
    ...plan,
    current_step_idx: currentStepIdx + 1,
  };

  return {
    step_results: [...(state.step_results || []), stepResult],
    research_plan: updatedPlan,
  };
}

export async function signalHandlerNode(state: AgentState): Promise<Partial<AgentState>> {
  const scratchpad = state.scratchpad || [];
  const unactedSignals = scratchpad.filter((s) => !s.acted_on && s.signal_type === "amend_plan");

  if (unactedSignals.length === 0 || !state.research_plan) {
    return {};
  }

  const plan = { ...state.research_plan };
  const sig = unactedSignals[0];

  if (plan.steps.length < 6) {
    const newStep = {
      step_id: `step_amended_${plan.steps.length + 1}`,
      tool: "web_search" as const,
      query: sig.payload,
      location: "",
      rationale: "Added via signal",
    };
    plan.steps.push(newStep);
  }

  const updatedScratchpad = scratchpad.map((s) => {
    if (s === sig) {
      return { ...s, acted_on: true };
    }
    return s;
  });

  return {
    research_plan: plan,
    scratchpad: updatedScratchpad,
  };
}

export async function evidenceEvaluatorNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log("\n   -> [evidence_evaluator] Auditing collected evidence for gaps or contradictions...");
  const stepResults = state.step_results || [];
  const parsedQuery = state.parsed_query || {};

  const credibilityReport = buildCredibilityReport(stepResults);
  const resultsSummary = stepResults
    .map((r) => `[${r.step_id}] ${r.tool}:\n${r.raw_data.slice(0, 400)}`)
    .join("\n\n");

  const context = `Original query: ${state.messages[0].content}
Topics to cover: ${(parsedQuery.topics || []).join(", ")}

Credibility Report:
${credibilityReport}

Evidence Collected:
${resultsSummary}`;

  const decision = await invokeStructured(
    evidenceEvaluator,
    [
      new SystemMessage({ content: EVIDENCE_EVALUATOR_PROMPT }),
      new HumanMessage({ content: context }),
    ],
    EvidenceSufficiencyDecisionSchema
  );

  console.log(`        Decision: ${decision.decision.toUpperCase()}`);

  if (decision.decision === "augment") {
    if ((state.augmentation_passes || 0) >= 1) {
      decision.decision = "proceed_with_caveats";
    } else {
      const plan = { ...state.research_plan } as ResearchPlan;
      const existingCount = plan.steps.length;

      decision.augmentation_steps?.forEach((aug, idx) => {
        plan.steps.push({
          step_id: `step_${existingCount + idx + 1}_aug`,
          tool: aug.tool,
          query: aug.query,
          location: aug.location,
          rationale: aug.rationale,
        });
      });

      return {
        research_plan: plan,
        augmentation_passes: (state.augmentation_passes || 0) + 1,
        scratchpad: [
          ...(state.scratchpad || []),
          {
            from_agent: "evidence_evaluator",
            to_agent: "any" as const,
            signal_type: "flag_finding" as const,
            payload: `Coverage gaps: ${JSON.stringify(decision.coverage_gaps)}. Contradictions: ${decision.contradiction_summary || ""}`,
            acted_on: false,
          },
        ],
      };
    }
  }

  // proceed or proceed_with_caveats
  let caveatSignal = null;
  if ((decision.coverage_gaps?.length || 0) > 0 || decision.contradiction_summary) {
    caveatSignal = {
      from_agent: "evidence_evaluator",
      to_agent: "any" as const,
      signal_type: "flag_finding" as const,
      payload: `Evidence caveats — Gaps: ${JSON.stringify(decision.coverage_gaps)}. Contradictions: ${decision.contradiction_summary || ""}. Overall confidence: ${decision.overall_confidence.toFixed(2)}`,
      acted_on: false,
    };
  }

  const updatedScratchpad = [...(state.scratchpad || [])];
  if (caveatSignal) {
    updatedScratchpad.push(caveatSignal);
  }

  return {
    scratchpad: updatedScratchpad,
  };
}

export async function optimistNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log("\n   -> [optimist] Drafting the best-case argument from the evidence...");
  const stepResults = state.step_results || [];
  const credibilityReport = buildCredibilityReport(stepResults);
  const evidenceText = formatEvidenceForDebate(stepResults);
  const gapSignals = (state.scratchpad || [])
    .filter((s) => s.signal_type === "flag_finding")
    .map((s) => s.payload);

  const context = `User query: ${state.messages[0].content}

Evidence:
${evidenceText}

Credibility scores:
${credibilityReport}

Known gaps/caveats:
${gapSignals.join("\n") || "None identified"}`;

  const argument = await invokeStructured(
    optimist,
    [
      new SystemMessage({ content: OPTIMIST_SYSTEM_PROMPT }),
      new HumanMessage({ content: context }),
    ],
    DebateArgumentSchema
  );

  return {
    optimist_argument: JSON.stringify(argument),
  };
}

export async function skepticNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log("\n   -> [skeptic] Challenging the Optimist's argument for weaknesses...");
  const stepResults = state.step_results || [];
  const credibilityReport = buildCredibilityReport(stepResults);
  const evidenceText = formatEvidenceForDebate(stepResults);
  const optimistArgText = state.optimist_argument || "No argument provided.";

  const context = `User query: ${state.messages[0].content}

Evidence:
${evidenceText}

Credibility scores:
${credibilityReport}

Optimist's argument:
${optimistArgText}`;

  const argument = await invokeStructured(
    skeptic,
    [
      new SystemMessage({ content: SKEPTIC_SYSTEM_PROMPT }),
      new HumanMessage({ content: context }),
    ],
    DebateArgumentSchema
  );

  return {
    skeptic_argument: JSON.stringify(argument),
  };
}

export async function judgeNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log("\n   -> [judge] Weighing the debate and synthesizing final calibrated answer...");
  const stepResults = state.step_results || [];
  const credibilityReport = buildCredibilityReport(stepResults);
  const evidenceText = formatEvidenceForDebate(stepResults);
  const optimistArg = state.optimist_argument || "";
  const skepticArg = state.skeptic_argument || "";

  const context = `User query: ${state.messages[0].content}

Evidence:
${evidenceText}

Credibility scores:
${credibilityReport}

Optimist's argument:
${optimistArg}

Skeptic's argument:
${skepticArg}`;

  const verdict = await invokeStructured(
    judge,
    [
      new SystemMessage({ content: JUDGE_SYSTEM_PROMPT }),
      new HumanMessage({ content: context }),
    ],
    JudgeVerdictSchema
  );

  return {
    final_answer: verdict.answer,
    answer_confidence: verdict.confidence,
    messages: [...state.messages, new AIMessage({ content: verdict.answer })],
  };
}
