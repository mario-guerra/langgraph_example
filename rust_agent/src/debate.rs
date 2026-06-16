use crate::schemas::*;
use crate::llm_utils::extract_with_retry;
use anyhow::Result;
use rig_core::completion::Prompt;

pub async fn run_debate<M1: Prompt + Sync + Send, M2: Prompt + Sync + Send>(
    model_opt: &M1,
    model_skp: &M2,
    query: &str,
    results: &[StepResult],
    _credibility: &CredibilityList,
) -> Result<(DebateArgument, DebateArgument)> {
    
    let mut evidence = String::new();
    for r in results {
        evidence.push_str(&format!("[{}]\n{:.500}\n\n", r.step_id, r.raw_data));
    }
    let input = format!("Query: {}\n\nEvidence:\n{}", query, evidence);

    let opt_prompt = r#"You are the Optimist. Argue the most well-supported, complete interpretation of the evidence.
Output JSON:
{
  "position": "optimist",
  "claim": "string",
  "evidence_cited": ["string"],
  "counterpoint_to": null,
  "confidence_in_claim": 0.0-1.0
}"#;

    let skp_prompt = r#"You are the Skeptic. Challenge the evidence rigorously. Point out gaps and contradictions.
Output JSON:
{
  "position": "skeptic",
  "claim": "string",
  "evidence_cited": ["string"],
  "counterpoint_to": null,
  "confidence_in_claim": 0.0-1.0
}"#;

    let opt_fut = extract_with_retry(model_opt, opt_prompt, &input);
    let skp_fut = extract_with_retry(model_skp, skp_prompt, &input);

    let (opt_res, skp_res) = tokio::join!(opt_fut, skp_fut);
    
    Ok((opt_res?, skp_res?))
}

pub async fn judge<M: Prompt + Sync + Send>(
    model: &M,
    query: &str,
    _results: &[StepResult],
    _credibility: &CredibilityList,
    optimist: &DebateArgument,
    skeptic: &DebateArgument,
) -> Result<JudgeVerdict> {
    
    let prompt = r#"You are the Judge. Produce a calibrated, honest final answer based on the debate arguments.
Output JSON:
{
  "answer": "string (markdown allowed)",
  "confidence": 0.0-1.0,
  "uncertainty_flags": ["string"],
  "recommended_followup": "string|null",
  "winning_position": "optimist|skeptic|split"
}"#;

    let input = format!("Query: {}\n\nOptimist: {}\n\nSkeptic: {}", query, optimist.claim, skeptic.claim);
    extract_with_retry(model, prompt, &input).await
}
