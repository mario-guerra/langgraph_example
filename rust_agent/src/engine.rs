use crate::schemas::*;

#[derive(Debug, Clone)]
pub enum WorkflowState {
    Start(String), 
    ParseIntent(String),
    Clarification(String, IntentSchema, ClarificationSchema),
    WaitUserClarification(String, IntentSchema, ClarificationSchema),
    Planning(String, IntentSchema),
    Executing(String, ResearchPlan, Vec<StepResult>),
    EvaluatingEvidence(String, ResearchPlan, Vec<StepResult>),
    ScoringCredibility(String, Vec<StepResult>),
    Debate(String, Vec<StepResult>, CredibilityList),
    Judge(String, Vec<StepResult>, CredibilityList, DebateArgument, DebateArgument),
    Done(JudgeVerdict),
}
