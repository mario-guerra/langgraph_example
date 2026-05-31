# Spec 04: Plan-Execute Architecture (Diamond 1)

## Problem

The current graph has a fixed topology:

```
coordinator → [weather_agent?] → [news_agent?] → summary_agent → END
```

This is hardcoded. Adding a new topic (traffic, finance, events) requires:
1. A new agent function
2. New conditional routing functions
3. New edges in `graph.py`

Worse: the "intelligence" of routing lives in keyword matching, not reasoning.

**The fix:** The LLM generates a typed research plan at runtime. The graph executes it. The topology is data, not code.

---

## Component: Planner

**File:** `planner.py` (new file)
**Responsibility:** Take `parsed_query` and generate a `ResearchPlan` with concrete, ordered steps.

### LLM Call

```python
from langchain_core.messages import HumanMessage, SystemMessage
from schemas import ResearchPlan
from state import AgentState

_planner = model.with_structured_output(ResearchPlan)

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
```

---

## Component: Executor Node

**File:** `agents.py`
**Responsibility:** Execute the current step in `research_plan`. One step per graph traversal. The graph loops back to the executor until the plan is complete.

```python
from tools import weather_search, news_search, web_search
from schemas import StepResult, EvidenceQuality, UncertaintyDecision, UncertaintyAction

TOOL_REGISTRY = {
    "weather_search": weather_search,
    "news_search":    news_search,
    "web_search":     web_search,  # new general tool
}

# LLM call to evaluate result quality after each step
_step_evaluator = model.with_structured_output(UncertaintyDecision)

STEP_EVALUATOR_PROMPT = """
You are a research quality evaluator.

Given:
- The user's original query
- The research step that was just executed (tool, query, rationale)  
- The raw result returned by the tool

Evaluate the result and decide:
- accept: The result adequately addresses this step's rationale. Confidence ≥ 0.6.
- retry: The result is incomplete, off-topic, or low quality. Provide an amended_query.
- escalate: The result reveals we need more information from the user to proceed.

Be honest about result quality. Do not accept thin or irrelevant results.
"""

def executor_node(state: AgentState) -> AgentState:
    """Execute the current plan step and evaluate the result."""
    plan_dict = state["research_plan"]
    plan = ResearchPlan(**plan_dict)
    current_step = plan.current_step()

    if current_step is None:
        return state  # Plan complete, should route to credibility scorer

    # Invoke the tool
    tool_fn = TOOL_REGISTRY.get(current_step.tool)
    if not tool_fn:
        raw_data = f"Unknown tool: {current_step.tool}"
        confidence = 0.0
    else:
        raw_data = tool_fn.invoke({
            "query": current_step.query,
            "location": current_step.location
        })
        confidence = None  # Set by evaluator below

    # Evaluate result quality
    eval_context = (
        f"Original query: {state['messages'][0].content}\n"
        f"Step rationale: {current_step.rationale}\n"
        f"Tool used: {current_step.tool}\n"
        f"Search query: {current_step.query}\n"
        f"Result:\n{raw_data}"
    )

    decision: UncertaintyDecision = invoke_structured(
        _step_evaluator,
        [
            {"role": "system", "content": STEP_EVALUATOR_PROMPT},
            {"role": "user",   "content": eval_context}
        ],
        UncertaintyDecision
    )

    # Build StepResult
    retry_count = state["retry_counts"].get(current_step.step_id, 0)

    if decision.action == UncertaintyAction.retry and retry_count < 2:
        # Amend the current step's query and retry (don't advance)
        plan.steps[plan.current_step_idx].query = decision.amended_query
        new_retry_counts = {**state["retry_counts"], current_step.step_id: retry_count + 1}

        return {
            **state,
            "research_plan": plan.model_dump(),
            "retry_counts": new_retry_counts,
        }

    # Accept or escalate — record result and advance
    step_result = StepResult(
        step_id=current_step.step_id,
        tool=current_step.tool,
        raw_data=raw_data,
        confidence=0.3 if decision.action == UncertaintyAction.retry else 0.8,
        evidence_quality=EvidenceQuality.low if decision.action == UncertaintyAction.retry
                         else EvidenceQuality.medium,
        gaps=[]
    )

    plan.advance()

    return {
        **state,
        "step_results": state.get("step_results", []) + [step_result.model_dump()],
        "research_plan": plan.model_dump(),
    }
```

> **Note on confidence:** The evaluator produces an `accept`/`retry`/`escalate` decision. Numeric confidence is derived from the decision and later refined by the credibility scorer (Spec 06). This is intentional — separating binary quality judgment from probabilistic scoring.

---

## Graph Routing for Plan-Execute Loop

```python
# graph.py

def route_executor(state: AgentState) -> str:
    """After each executor step, decide where to go."""
    plan_dict = state.get("research_plan", {})
    if not plan_dict:
        return "credibility_scorer"

    plan = ResearchPlan(**plan_dict)

    # Check for unacted signals requesting plan amendment
    scratchpad = state.get("scratchpad", [])
    pending_signals = [s for s in scratchpad if not s.get("acted_on")
                       and s.get("signal_type") == "amend_plan"]
    if pending_signals:
        return "signal_handler"  # See Spec 05

    if plan.is_complete():
        return "credibility_scorer"

    return "executor"  # Loop back for next step
```

---

## Plan-Execute Flow (C4 Component Sequence)

```
Planner           Executor          Tool          Signal Handler
   │                 │               │                  │
   │──[ResearchPlan]▶│               │                  │
   │                 │──[step_1]────▶│                  │
   │                 │◀──[result]────│                  │
   │                 │──[evaluate]   │                  │
   │                 │  [accept]     │                  │
   │                 │──[check sigs]─────────────────── ▶│
   │                 │◀──[no sigs]───────────────────── │
   │                 │──[step_2]────▶│                  │
   │                 │◀──[result]────│                  │
   │                 │──[evaluate]   │                  │
   │                 │  [retry]      │                  │
   │                 │──[step_2 amended]▶│              │
   │                 │◀──[better result]─│              │
   │                 │──[accept]     │                  │
   │                 │  [plan complete]  │              │
   │                 │──▶ credibility_scorer            │
```

---

## New Tool: web_search

The planner references `web_search` as a third tool type for general queries. This must be added to `tools.py`:

```python
@tool
def web_search(query: str, location: str = "") -> str:
    """General-purpose web search for topics beyond weather and news."""
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return "SerpAPI key not found."

    search_query = f"{location} {query}".strip() if location else query
    params = {
        "q": search_query,
        "api_key": api_key,
        "hl": "en",
        "num": 5,
    }

    try:
        search = GoogleSearch(params)
        results = search.get_dict()
        if "organic_results" in results and results["organic_results"]:
            items = []
            for item in results["organic_results"][:4]:
                title = item.get("title", "")
                snippet = item.get("snippet", "")
                source = item.get("displayed_link", "")
                items.append(f"• [{source}] {title}\n  {snippet}")
            return "\n\n".join(items)
        return f"No results found for: {search_query}"
    except Exception as e:
        return f"Error: {str(e)}"
```

---

## Example: Plan for "Should I go to the outdoor concert in Austin tonight?"

```
Planner output (ResearchPlan):
  step_1: weather_search
    query: "Austin TX weather tonight outdoor conditions"
    location: "Austin, TX"
    rationale: "Need current weather to assess outdoor safety"

  step_2: news_search
    query: "Austin TX outdoor concert tonight weather cancellation"
    location: "Austin, TX"
    rationale: "Check for any event cancellations or weather warnings in news"

  step_3: web_search
    query: "Austin TX outdoor venues flooding or storm warnings tonight"
    location: "Austin, TX"
    rationale: "Supplement news with any official weather advisories"
```

No code changes needed when this query type is introduced. The planner handles it.
