use crate::schemas::*;
use crate::llm_utils::extract_with_retry;
use anyhow::Result;
use rig_core::completion::Prompt;

pub async fn generate_plan<M: Prompt + Sync + Send>(model: &M, query: &str, intent: &IntentSchema) -> Result<ResearchPlan> {
    let prompt = r#"You are a research planner for an information retrieval system.
Tools:
- weather_search
- news_search
- web_search

Rules:
1. Max 4 steps. Each uses exactly one tool.
2. Queries must be specific.

Output JSON:
{
  "steps": [
    {
      "step_id": "step_1",
      "tool": "weather_search|news_search|web_search",
      "query": "string",
      "location": "string",
      "rationale": "string"
    }
  ]
}"#;
    let input = format!("Location: {}\nTopics: {:?}\nOriginal query: {}", intent.location, intent.topics, query);
    extract_with_retry(model, prompt, &input).await
}
