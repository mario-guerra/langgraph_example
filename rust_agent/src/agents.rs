use crate::schemas::*;
use crate::llm_utils::extract_with_retry;
use anyhow::Result;
use rig_core::completion::Prompt;

pub async fn parse_intent<M: Prompt + Sync + Send>(model: &M, query: &str) -> Result<IntentSchema> {
    let prompt = r#"You are an intent extraction engine for a research assistant.
Given a user query, extract:
1. location: Fully resolved location (e.g. NYC -> New York, NY). Empty string if none.
2. topics: List of research topics. Do not limit to weather/news.
3. time_range: "now", "today", "tonight", "this_week", "unspecified"
4. is_ambiguous: True only when multiple distinct interpretations exist.
5. ambiguity_reason: One sentence if ambiguous.

Output strictly as a JSON object matching this schema:
{
  "location": "string",
  "topics": ["string"],
  "time_range": "string",
  "is_ambiguous": boolean,
  "ambiguity_reason": "string or null"
}"#;
    extract_with_retry(model, prompt, query).await
}

pub async fn generate_clarification<M: Prompt + Sync + Send>(model: &M, query: &str, intent: &IntentSchema) -> Result<ClarificationSchema> {
    let prompt = r#"You are a clarification agent. The user's query is ambiguous.
Generate exactly ONE targeted question that, when answered, fully resolves the ambiguity.
Output JSON:
{
  "question": "string",
  "resolves_ambiguity": "string"
}"#;
    let input = format!("User query: {}\nDetected ambiguity: {:?}", query, intent.ambiguity_reason);
    extract_with_retry(model, prompt, &input).await
}

pub async fn evaluate_step<M: Prompt + Sync + Send>(model: &M, query: &str, step: &PlanStep, raw_data: &str) -> Result<UncertaintyDecision> {
    let prompt = r#"You are a research quality evaluator.
Decide:
- accept: The result addresses the step's rationale.
- retry: The result is bad. Provide amended_query.
- escalate: We need user info. Provide escalation_question.
Output JSON:
{
  "action": "accept|retry|escalate",
  "amended_query": "string|null",
  "escalation_question": "string|null",
  "reasoning": "string",
  "confidence": float (0.0-1.0),
  "gaps": ["string"]
}"#;
    let input = format!("Original query: {}\nStep rationale: {}\nTool: {}\nQuery: {}\nResult:\n{}", query, step.rationale, step.tool, step.query, raw_data);
    extract_with_retry(model, prompt, &input).await
}

pub async fn evaluate_evidence<M: Prompt + Sync + Send>(model: &M, query: &str, results: &[StepResult]) -> Result<EvidenceSufficiencyDecision> {
    let prompt = r#"You are a research completeness auditor.
Is the evidence collected sufficient?
Decision options:
- proceed: Evidence is sufficient.
- augment: specific gap exists. Provide augmentation_steps (max 2).
- proceed_with_caveats: Evidence is thin but more searches won't help.
Output JSON:
{
  "decision": "proceed|augment|proceed_with_caveats",
  "coverage_gaps": ["string"],
  "contradiction_summary": "string|null",
  "augmentation_steps": [
    { "tool": "web_search", "query": "str", "location": "str", "rationale": "str" }
  ],
  "overall_confidence": 0.0-1.0
}"#;
    
    let mut results_summary = String::new();
    for r in results {
        results_summary.push_str(&format!("[{}] {}:\n{:.400}\n\n", r.step_id, r.tool, r.raw_data));
    }
    let input = format!("Original query: {}\n\nEvidence Collected:\n{}", query, results_summary);
    extract_with_retry(model, prompt, &input).await
}
