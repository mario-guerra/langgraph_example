pub mod schemas;
pub mod tools;
pub mod llm_utils;
pub mod engine;
pub mod agents;
pub mod planner;
pub mod credibility;
pub mod debate;

use crate::engine::WorkflowState;
use crate::schemas::*;
use std::io::{self, Write};
use dotenv::dotenv;
use rig_core::providers::{openai, anthropic};
use rig_vertexai;
use rig_core::client::completion::CompletionClient;

use reqwest_middleware::ClientBuilder;
use orchid_sdk::{OrchidMiddleware, OrchidContext, Mode, scope};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();
    
    // 1. Initialize Orchid Middleware HTTP Client
    let client_with_middleware = ClientBuilder::new(reqwest::Client::new())
        .with(OrchidMiddleware::new())
        .build();

    // 2. Initialize LLM Providers with the custom HTTP client
    let openai_key = std::env::var("OPENAI_API_KEY").expect("OPENAI_API_KEY not set");
    let anthropic_key = std::env::var("ANTHROPIC_API_KEY").expect("ANTHROPIC_API_KEY not set");
    
    // Note: If rig-core requires specifically `reqwest::Client` rather than accepting `ClientWithMiddleware`, 
    // it will throw a compile error here. We are injecting the Orchid pipeline directly into the provider builders.
    let openai_client = openai::Client::builder()
        .api_key(openai_key.as_str())
        .http_client(client_with_middleware.clone())
        .build()?;
        
    let anthropic_client = anthropic::Client::builder()
        .api_key(anthropic_key.as_str())
        .http_client(client_with_middleware.clone())
        .build()?;
    
    // For rig_vertexai, if it supports custom clients:
    let vertex_client = rig_vertexai::Client::from_env().expect("Failed to initialize Vertex AI client");
    
    let workhorse = vertex_client.agent("gemini-2.5-flash").build();
    let evaluator = anthropic_client.agent("claude-sonnet-4-6").max_tokens(4096).build();
    let planner_model = openai_client.agent("o3-mini").build();
    
    let _ = std::env::var("SERPAPI_API_KEY").expect("SERPAPI_API_KEY environment variable is required to run the agent");

    println!("Adaptive Multi-Agent Research System (Rust Port)");
    println!("--------------------------------------------------");

    // 3. Define the tracking context for the Orchid Proxy
    let ctx = OrchidContext {
        session_id: "langgraph-rust-agent-session".into(),
        mode: Mode::Capture, // Change to Replay or Passthrough as needed
    };

    // 4. Wrap the entire application loop in the Orchid scope
    scope(ctx, async {
        loop {
            print!("\nEnter your query (or 'quit' to exit): ");
            io::stdout().flush().unwrap();
        
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let input = input.trim();
        
        if input.eq_ignore_ascii_case("quit") || input.eq_ignore_ascii_case("exit") {
            break;
        }
        
        if input.is_empty() {
            continue;
        }

        let mut state = WorkflowState::Start(input.to_string());
        
        loop {
            match state {
                WorkflowState::Start(q) => {
                    state = WorkflowState::ParseIntent(q);
                }
                WorkflowState::ParseIntent(q) => {
                    println!("🧠 Parsing intent...");
                    let intent = agents::parse_intent(&workhorse, &q).await?;
                    if intent.is_ambiguous {
                        state = WorkflowState::Clarification(q, intent, ClarificationSchema {
                            question: "".to_string(),
                            resolves_ambiguity: "".to_string(),
                        });
                    } else {
                        state = WorkflowState::Planning(q, intent);
                    }
                }
                WorkflowState::Clarification(q, intent, _) => {
                    println!("🧠 Generating clarification...");
                    let clar = agents::generate_clarification(&workhorse, &q, &intent).await?;
                    state = WorkflowState::WaitUserClarification(q, intent, clar);
                }
                WorkflowState::WaitUserClarification(q, intent, clar) => {
                    print!("❓ Clarification needed: {}\nYour answer: ", clar.question);
                    io::stdout().flush()?;
                    let mut ans = String::new();
                    io::stdin().read_line(&mut ans)?;
                    let combined_q = format!("Original: {}\nClarification: {}", q, ans.trim());
                    state = WorkflowState::Planning(combined_q, intent);
                }
                WorkflowState::Planning(q, intent) => {
                    println!("🧠 Planning research...");
                    let plan = planner::generate_plan(&planner_model, &q, &intent).await?;
                    state = WorkflowState::Executing(q, plan, vec![]);
                }
                WorkflowState::Executing(q, plan, mut results) => {
                    println!("🧠 Executing plan...");
                    for step in &plan.steps {
                        println!("  -> [{}] Running {}...", step.step_id, step.tool);
                        let api_key = std::env::var("SERPAPI_API_KEY").unwrap_or_default();
                        
                        let raw_data = match step.tool.as_str() {
                            "weather_search" => tools::weather_search(&step.query, &step.location, &api_key).await.unwrap_or_else(|e| format!("System Error: Search failed: {}", e)),
                            "news_search" => tools::news_search(&step.query, &step.location, &api_key).await.unwrap_or_else(|e| format!("System Error: Search failed: {}", e)),
                            _ => tools::web_search(&step.query, &step.location, &api_key).await.unwrap_or_else(|e| format!("System Error: Search failed: {}", e)),
                        };
                        
                        let eval = agents::evaluate_step(&evaluator, &q, step, &raw_data).await?;
                        results.push(StepResult {
                            step_id: step.step_id.clone(),
                            tool: step.tool.clone(),
                            raw_data,
                            confidence: eval.confidence, 
                            evidence_quality: eval.action,
                            gaps: eval.gaps,
                        });
                    }
                    state = WorkflowState::EvaluatingEvidence(q, plan, results);
                }
                WorkflowState::EvaluatingEvidence(q, _plan, results) => {
                    println!("🧠 Evaluating evidence...");
                    let _decision = agents::evaluate_evidence(&evaluator, &q, &results).await?;
                    state = WorkflowState::ScoringCredibility(q, results);
                }
                WorkflowState::ScoringCredibility(q, results) => {
                    println!("🧠 Scoring credibility...");
                    let cred = credibility::score_sources(&workhorse, &results).await?;
                    state = WorkflowState::Debate(q, results, cred);
                }
                WorkflowState::Debate(q, results, cred) => {
                    println!("🧠 Running parallel debate...");
                    let (opt, skp) = debate::run_debate(&planner_model, &evaluator, &q, &results, &cred).await?;
                    state = WorkflowState::Judge(q, results, cred, opt, skp);
                }
                WorkflowState::Judge(q, results, cred, opt, skp) => {
                    println!("🧠 Judging...");
                    let verdict = debate::judge(&evaluator, &q, &results, &cred, &opt, &skp).await?;
                    state = WorkflowState::Done(verdict);
                }
                WorkflowState::Done(verdict) => {
                    println!("\n📋 Final Answer (Confidence: {:.2}):", verdict.confidence);
                    println!("{}", verdict.answer);
                    break;
                }
            }
        }
    }
        
    Ok::<(), anyhow::Error>(())
}).await?;
    
    Ok(())
}
