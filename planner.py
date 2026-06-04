"""Planner node."""
from langchain_core.messages import HumanMessage, SystemMessage
from schemas import ResearchPlan
from state import AgentState
from llm import o3_mini
from utils import invoke_structured

_planner = o3_mini.with_structured_output(ResearchPlan)

PLANNER_SYSTEM_PROMPT = """
You are a research planner for an information retrieval system.

Available tools:
- weather_search(query, location): Retrieves current conditions, forecasts, alerts
- news_search(query, location): Retrieves recent news articles (last 48h)
- web_search(query, location): General-purpose web search for anything else

Given a parsed user intent, generate a concrete research plan.
Rules:
1. Each step must use exactly one tool.
2. Steps should be ordered so that dependent information comes first.
3. Do not generate redundant steps. If weather_search covers the need, don't add web_search for the same.
4. Maximum 4 steps per plan. Force yourself to be efficient.
5. Each query must be specific — not "weather" but "Austin TX weather tonight outdoor safety".

Think step by step before generating the plan.
"""

def planner_node(state: AgentState) -> AgentState:
    """Planner node — generates the research plan from parsed intent."""
    parsed = state["parsed_query"]

    context = (
        f"Location: {parsed.get('location', 'not specified')}\n"
        f"Topics: {', '.join(parsed.get('topics', []))}\n"
        f"Time range: {parsed.get('time_range', 'unspecified')}\n"
        f"Original query: {state['messages'][0].content}"
    )

    plan: ResearchPlan = invoke_structured(
        _planner,
        [
            SystemMessage(content=PLANNER_SYSTEM_PROMPT),
            HumanMessage(content=context)
        ],
        ResearchPlan
    )

    # Initialize retry counts for all steps
    retry_counts = {step.step_id: 0 for step in plan.steps}

    return {
        **state,
        "research_plan": plan.model_dump(),
        "retry_counts": retry_counts,
    }
