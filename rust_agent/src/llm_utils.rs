use anyhow::{anyhow, Result};
use rig_core::completion::Prompt;
use serde::de::DeserializeOwned;
use backoff::{future::retry, ExponentialBackoff};
use std::time::Duration;

pub async fn extract_with_retry<M, T>(model: &M, system_prompt: &str, user_input: &str) -> Result<T>
where
    M: Prompt + Sync + Send,
    T: DeserializeOwned + Send,
{
    let mut backoff = ExponentialBackoff::default();
    backoff.max_elapsed_time = Some(Duration::from_secs(30));
    
    let full_prompt = format!(
        "{}\n\nReturn ONLY a valid raw JSON object conforming strictly to the required schema. Do NOT wrap it in markdown backticks.\n\nInput: {}",
        system_prompt, user_input
    );
    
    retry(backoff, || async {
        let raw_response = model.prompt(&full_prompt).await.map_err(|e| backoff::Error::transient(anyhow::anyhow!(e)))?;
        
        let cleaned = raw_response.trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
            
        match serde_json::from_str::<T>(cleaned) {
            Ok(parsed) => Ok(parsed),
            Err(e) => {
                Err(backoff::Error::transient(anyhow!("Failed to parse JSON: {}. Raw: {}", e, cleaned)))
            }
        }
    })
    .await
}
