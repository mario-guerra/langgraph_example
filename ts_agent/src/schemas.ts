import { z } from "zod";

export const IntentSchema = z.object({
  location: z.string().describe("Fully resolved location (e.g. 'Austin, TX'). Empty string if no location is mentioned."),
  topics: z.array(z.string()).describe("List of research topics inferred from the query. Examples: ['weather'], ['news'], ['weather', 'outdoor_events'], ['traffic', 'road_conditions']. At least one topic required."),
  time_range: z.enum(["now", "today", "tonight", "this_week", "unspecified"]).describe("Temporal scope of the query."),
  is_ambiguous: z.boolean().describe("True if the query is genuinely ambiguous — i.e., multiple interpretations exist that would lead to different research plans."),
  ambiguity_reason: z.string().optional().describe("Required when is_ambiguous=True. One sentence explaining the specific ambiguity.")
}).superRefine((data, ctx) => {
  if (data.is_ambiguous && (!data.ambiguity_reason || data.ambiguity_reason.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ambiguity_reason is required when is_ambiguous=True",
      path: ["ambiguity_reason"]
    });
  }
  if (!data.is_ambiguous) {
    data.ambiguity_reason = undefined;
  }
  if (!data.topics || data.topics.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "topics must contain at least one item",
      path: ["topics"]
    });
  }
});

export type Intent = z.infer<typeof IntentSchema>;

export const ClarificationSchema = z.object({
  question: z.string().describe("A single, specific question that resolves the detected ambiguity. Must not ask multiple questions. Must be answerable in one sentence."),
  resolves_ambiguity: z.string().describe("Explains what the answer to this question will disambiguate.")
});

export type Clarification = z.infer<typeof ClarificationSchema>;

export const PlanStepSchema = z.object({
  step_id: z.string().describe("Unique identifier, e.g. 'step_1', 'step_2'."),
  tool: z.enum(["weather_search", "news_search", "web_search"]).describe("Which tool to invoke for this step."),
  query: z.string().describe("The search query to pass to the tool."),
  location: z.string().describe("Location context for the search. Empty string if not applicable."),
  rationale: z.string().describe("Why this step is necessary given the user's query.")
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ResearchPlanSchema = z.object({
  steps: z.array(PlanStepSchema).describe("Ordered list of research steps. Must have at least one step."),
  current_step_idx: z.number().default(0).describe("Index into steps. Managed by the executor, not the LLM.")
}).superRefine((data, ctx) => {
  if (!data.steps || data.steps.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Research plan must contain at least one step",
      path: ["steps"]
    });
  }
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// Immutable utility functions for ResearchPlan matching Python's class methods
export function currentStep(plan: ResearchPlan): PlanStep | null {
  if (plan.current_step_idx < plan.steps.length) {
    return plan.steps[plan.current_step_idx];
  }
  return null;
}

export function isPlanComplete(plan: ResearchPlan): boolean {
  return plan.current_step_idx >= plan.steps.length;
}

export function advancePlan(plan: ResearchPlan): ResearchPlan {
  return {
    ...plan,
    current_step_idx: plan.current_step_idx + 1
  };
}

export function appendPlanStep(plan: ResearchPlan, step: PlanStep): ResearchPlan {
  return {
    ...plan,
    steps: [...plan.steps, step]
  };
}

export const EvidenceQualitySchema = z.enum(["low", "medium", "high"]);
export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

export const CredibilityAnnotationSchema = z.object({
  source: z.string(),
  trust_score: z.number(),
  recency_score: z.number(),
  relevance_score: z.number(),
  contradicts_step_ids: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export type CredibilityAnnotation = z.infer<typeof CredibilityAnnotationSchema>;

export const StepResultSchema = z.object({
  step_id: z.string(),
  tool: z.string(),
  raw_data: z.string(),
  confidence: z.number().min(0.0).max(1.0),
  evidence_quality: EvidenceQualitySchema,
  gaps: z.array(z.string()).default([]).describe("Specific information gaps the LLM identified in this result."),
  credibility: z.array(CredibilityAnnotationSchema).optional()
});

export type StepResult = z.infer<typeof StepResultSchema>;

export const UncertaintyActionSchema = z.enum(["accept", "retry", "escalate"]);
export type UncertaintyAction = z.infer<typeof UncertaintyActionSchema>;

export const UncertaintyDecisionSchema = z.object({
  action: UncertaintyActionSchema,
  amended_query: z.string().optional().describe("Required when action=retry. The revised search query."),
  escalation_question: z.string().optional().describe("Required when action=escalate."),
  reasoning: z.string().describe("One sentence explaining the decision.")
}).superRefine((data, ctx) => {
  if (data.action === "retry" && (!data.amended_query || data.amended_query.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "amended_query required when action=retry",
      path: ["amended_query"]
    });
  }
  if (data.action === "escalate" && (!data.escalation_question || data.escalation_question.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "escalation_question required when action=escalate",
      path: ["escalation_question"]
    });
  }
});

export type UncertaintyDecision = z.infer<typeof UncertaintyDecisionSchema>;

export const SignalTypeSchema = z.enum(["amend_plan", "flag_finding", "warn"]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const AgentSignalSchema = z.object({
  from_agent: z.string(),
  to_agent: z.enum(["controller", "any", "weather_agent", "news_agent", "planner"]),
  signal_type: SignalTypeSchema,
  payload: z.string().describe("Free-text content of the signal. For amend_plan, describe what step to add and why."),
  acted_on: z.boolean().default(false)
});

export type AgentSignal = z.infer<typeof AgentSignalSchema>;

export const DebateArgumentSchema = z.object({
  position: z.enum(["optimist", "skeptic"]),
  claim: z.string().describe("The main claim being argued."),
  evidence_cited: z.array(z.string()).describe("List of step_ids referenced as evidence."),
  counterpoint_to: z.string().nullable().describe("If this argument responds to the other side, reference their claim."),
  confidence_in_claim: z.number().min(0.0).max(1.0)
});

export type DebateArgument = z.infer<typeof DebateArgumentSchema>;

export const JudgeVerdictSchema = z.object({
  answer: z.string().describe("The complete, user-facing answer. Markdown allowed."),
  confidence: z.number().min(0.0).max(1.0).describe("Judge's calibrated confidence in the answer."),
  uncertainty_flags: z.array(z.string()).default([]).describe("Specific claims in the answer the user should treat with caution."),
  recommended_followup: z.string().optional().describe("One follow-up action the user could take to resolve remaining uncertainty."),
  winning_position: z.enum(["optimist", "skeptic", "split"]).describe("Which debate position was better-supported by evidence.")
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const ClarificationStateSchema = z.object({
  question: z.string(),
  awaiting_response: z.boolean().default(true),
  user_answer: z.string().optional()
});

export type ClarificationState = z.infer<typeof ClarificationStateSchema>;

export const AugmentStepSchema = z.object({
  tool: z.enum(["weather_search", "news_search", "web_search"]),
  query: z.string(),
  location: z.string(),
  rationale: z.string()
});

export type AugmentStep = z.infer<typeof AugmentStepSchema>;

export const EvidenceSufficiencyDecisionSchema = z.object({
  decision: z.enum(["proceed", "augment", "proceed_with_caveats"]),
  coverage_gaps: z.array(z.string()).default([]).describe("Topics from the original query not adequately covered."),
  contradiction_summary: z.string().optional().describe("Summary of detected contradictions, if any."),
  augmentation_steps: z.array(AugmentStepSchema).default([]).describe("Required when decision=augment. Max 2 steps."),
  overall_confidence: z.number().min(0.0).max(1.0)
}).superRefine((data, ctx) => {
  if (data.decision === "augment" && (!data.augmentation_steps || data.augmentation_steps.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "augmentation_steps required when decision=augment",
      path: ["augmentation_steps"]
    });
  }
  if (data.augmentation_steps && data.augmentation_steps.length > 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Maximum 2 augmentation steps",
      path: ["augmentation_steps"]
    });
  }
});

export type EvidenceSufficiencyDecision = z.infer<typeof EvidenceSufficiencyDecisionSchema>;
