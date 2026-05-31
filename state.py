from typing import TypedDict, Annotated, List, Optional
from operator import add
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from schemas import ResearchPlan, StepResult, AgentSignal, ClarificationState

class AgentState(TypedDict):
    """State shared across all agents in the graph."""
    
    # ── Conversation ─────────────────────────────────────────
    messages: Annotated[List[HumanMessage | AIMessage | ToolMessage], add]

    # ── Parsed Intent ────────────────────────────────────────
    parsed_query: dict                  # Output of IntentSchema structured output

    # ── Clarification ────────────────────────────────────────
    clarification: Optional[ClarificationState]

    # ── Research Plan ────────────────────────────────────────
    research_plan: Optional[dict]       # Will store ResearchPlan.model_dump()

    # ── Step Results ─────────────────────────────────────────
    step_results: List[dict]            # Stores StepResult.model_dump()

    # ── Cross-Agent Signals ──────────────────────────────────
    scratchpad: List[dict]              # Stores AgentSignal dicts

    # ── Uncertainty Tracking ─────────────────────────────────
    retry_counts: dict                  # {step_id: int}
    augmentation_passes: int            # Max 1 pass

    # ── Final Answer ─────────────────────────────────────────
    optimist_argument: Optional[str]
    skeptic_argument: Optional[str]
    final_answer: Optional[str]
    answer_confidence: Optional[float]

