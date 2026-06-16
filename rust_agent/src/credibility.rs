use crate::schemas::*;
use crate::llm_utils::extract_with_retry;
use anyhow::Result;
use rig_core::completion::Prompt;

pub async fn score_sources<M: Prompt + Sync + Send>(model: &M, results: &[StepResult]) -> Result<CredibilityList> {
    let prompt = r#"You are a research credibility scorer. Evaluate the provided search results.
Output a JSON array of annotations under "annotations".
{
  "annotations": [
    {
      "source": "string",
      "authority_score": 0.0-1.0,
      "recency_score": 0.0-1.0,
      "relevance_score": 0.0-1.0,
      "contradicts_step_ids": ["string"],
      "notes": "string|null"
    }
  ]
}"#;

    let mut input = String::new();
    for r in results {
        input.push_str(&format!("Step [{}]: Tool: {}\nRaw: {}\n\n", r.step_id, r.tool, r.raw_data));
    }
    
    extract_with_retry(model, prompt, &input).await
}
