use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct IntentSchema {
    #[schemars(description = "Fully resolved location (e.g. 'Austin, TX'). Empty string if no location is mentioned.")]
    pub location: String,
    
    #[schemars(description = "List of research topics inferred from the query. Examples: ['weather'], ['news']. At least one topic required.")]
    pub topics: Vec<String>,
    
    #[schemars(description = "Temporal scope of the query: 'now', 'today', 'tonight', 'this_week', 'unspecified'")]
    pub time_range: String,
    
    #[schemars(description = "True if the query is genuinely ambiguous — i.e., multiple interpretations exist that would lead to different research plans.")]
    pub is_ambiguous: bool,
    
    #[schemars(description = "Required when is_ambiguous=True. One sentence explaining the specific ambiguity.")]
    pub ambiguity_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct ClarificationSchema {
    #[schemars(description = "A single, specific question that resolves the detected ambiguity. Must not ask multiple questions. Must be answerable in one sentence.")]
    pub question: String,
    
    #[schemars(description = "Explains what the answer to this question will disambiguate.")]
    pub resolves_ambiguity: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct PlanStep {
    #[schemars(description = "Unique identifier, e.g. 'step_1', 'step_2'.")]
    pub step_id: String,
    
    #[schemars(description = "Which tool to invoke for this step: 'weather_search', 'news_search', 'web_search'.")]
    pub tool: String,
    
    #[schemars(description = "The search query to pass to the tool.")]
    pub query: String,
    
    #[schemars(description = "Location context for the search. Empty string if not applicable.")]
    pub location: String,
    
    #[schemars(description = "Why this step is necessary given the user's query.")]
    pub rationale: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct ResearchPlan {
    #[schemars(description = "Ordered list of research steps. Must have at least one step.")]
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct CredibilityAnnotation {
    pub source: String,
    
    #[schemars(description = "Authority score from 0.0 to 1.0")]
    pub authority_score: f32,
    
    #[schemars(description = "Recency score from 0.0 to 1.0")]
    pub recency_score: f32,
    
    #[schemars(description = "Relevance score from 0.0 to 1.0")]
    pub relevance_score: f32,
    
    #[schemars(description = "List of step_ids this source contradicts")]
    pub contradicts_step_ids: Vec<String>,
    
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct CredibilityList {
    pub annotations: Vec<CredibilityAnnotation>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct UncertaintyDecision {
    #[schemars(description = "action: 'accept', 'retry', or 'escalate'")]
    pub action: String,
    
    #[schemars(description = "Required when action='retry'. The revised search query.")]
    pub amended_query: Option<String>,
    
    #[schemars(description = "Required when action='escalate'.")]
    pub escalation_question: Option<String>,
    
    #[schemars(description = "One sentence explaining the decision.")]
    pub reasoning: String,
    
    #[schemars(description = "Confidence in the accuracy of the result from 0.0 to 1.0")]
    pub confidence: f32,
    
    #[schemars(description = "Information gaps not covered by the result. Empty list if none.")]
    #[serde(default)]
    pub gaps: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct AugmentStep {
    pub tool: String,
    pub query: String,
    pub location: String,
    pub rationale: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct EvidenceSufficiencyDecision {
    #[schemars(description = "decision: 'proceed', 'augment', 'proceed_with_caveats'")]
    pub decision: String,
    
    #[schemars(description = "Topics from the original query not adequately covered.")]
    pub coverage_gaps: Vec<String>,
    
    #[schemars(description = "Summary of detected contradictions, if any.")]
    pub contradiction_summary: Option<String>,
    
    #[schemars(description = "Required when decision=augment. Max 2 steps.")]
    pub augmentation_steps: Vec<AugmentStep>,
    
    #[schemars(description = "Confidence from 0.0 to 1.0")]
    pub overall_confidence: f32,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct DebateArgument {
    #[schemars(description = "'optimist' or 'skeptic'")]
    pub position: String,
    
    #[schemars(description = "The main claim being argued.")]
    pub claim: String,
    
    #[schemars(description = "List of step_ids referenced as evidence.")]
    pub evidence_cited: Vec<String>,
    
    #[schemars(description = "If this argument responds to the other side, reference their claim.")]
    pub counterpoint_to: Option<String>,
    
    #[schemars(description = "Confidence from 0.0 to 1.0")]
    pub confidence_in_claim: f32,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct JudgeVerdict {
    #[schemars(description = "The complete, user-facing answer. Markdown allowed.")]
    pub answer: String,
    
    #[schemars(description = "Judge's calibrated confidence in the answer from 0.0 to 1.0")]
    pub confidence: f32,
    
    #[schemars(description = "Specific claims in the answer the user should treat with caution.")]
    pub uncertainty_flags: Vec<String>,
    
    #[schemars(description = "One follow-up action the user could take to resolve remaining uncertainty.")]
    pub recommended_followup: Option<String>,
    
    #[schemars(description = "'optimist', 'skeptic', or 'split'")]
    pub winning_position: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Clone)]
pub struct StepResult {
    pub step_id: String,
    pub tool: String,
    pub raw_data: String,
    pub confidence: f32,
    pub evidence_quality: String,
    pub gaps: Vec<String>,
}
