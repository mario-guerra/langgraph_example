# Spec 01: Expanded AgentState Design

## Current State (Baseline)

```python
# state.py — CURRENT
class AgentState(TypedDict):
    messages: Annotated[List[HumanMessage | AIMessage | ToolMessage], add]
    location: str
    intent: Literal["weather", "news", "both", "unknown"]
    weather_data: str
    news_data: str
```

Problems:
- `intent` is a fixed enum — locks routing to hardcoded paths
- `weather_data` / `news_data` are raw strings — no structure, no confidence, no evidence quality
- No field for the research plan (Plan-Execute needs it)
- No scratchpad for cross-agent signals
- No uncertainty tracking
- No conversation memory for multi-turn clarification
- `messages` accumulates additively (the `add` reducer) — correct behavior, keep it

---

## New State Design

```python
# state.py — NEW
from typing import TypedDict, Annotated, List, Optional
from operator import add
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from schemas import ResearchPlan, StepResult, AgentSignal, ClarificationState

class AgentState(TypedDict):
    # ── Conversation ─────────────────────────────────────────
    messages: Annotated[List[HumanMessage | AIMessage | ToolMessage], add]

    # ── Parsed Intent (replaces str intent + str location) ───
    parsed_query: dict                  # Output of IntentSchema structured output
                                        # Keys: location, topics, time_range,
                                        #       is_ambiguous, ambiguity_reason

    # ── Clarification (Gold 3) ───────────────────────────────
    clarification: Optional[ClarificationState]
                                        # None until ambiguity detected
                                        # {question, awaiting_response, user_answer}

    # ── Research Plan (Diamond 1) ────────────────────────────
    research_plan: Optional[ResearchPlan]
                                        # None until planner runs
                                        # {steps: List[PlanStep], current_step_idx}

    # ── Step Results (replaces weather_data/news_data) ───────
    step_results: List[StepResult]
                                        # Replaces entirely on update (no reducer)
                                        # Nodes MUST append manually: state.get("step_results", []) + [new]

    # ── Cross-Agent Signals (Gold 1) ─────────────────────────
    scratchpad: List[AgentSignal]
                                        # Replaces entirely on update (no reducer)
                                        # Nodes MUST append manually: state.get("scratchpad", []) + [new]

    # ── Uncertainty Tracking (Diamond 3) ─────────────────────
    retry_counts: dict                  # {step_id: int} — max 2 retries per step
    augmentation_passes: int            # Max 1 pass to prevent infinite loops

    # ── Final Answer ─────────────────────────────────────────
    optimist_argument: Optional[str]    # Set by debate_optimist node
    skeptic_argument: Optional[str]     # Set by debate_skeptic node
    final_answer: Optional[str]         # Set by Judge after debate
    answer_confidence: Optional[float]  # Judge's calibrated confidence
```

---

## Field Responsibilities

### `parsed_query: dict`

Replaces `location: str` and `intent: Literal[...]`. Set once by the intent parser. Structure:

```python
{
    "location": "Austin, TX",
    "topics": ["weather", "outdoor_events"],   # open list, not fixed enum
    "time_range": "tonight",                    # "now" | "today" | "tonight" | "this_week" | ...
    "is_ambiguous": False,
    "ambiguity_reason": None
}
```

The move from a fixed `Literal["weather","news","both","unknown"]` to an open `topics: List[str]` is deliberate. It allows the Plan-Execute system to handle arbitrary topic combinations without code changes.

### `research_plan: Optional[ResearchPlan]`

Populated by the Planner node. `None` until planning completes. Once set, the executor walks `steps` in order, incrementing `current_step_idx`. Plan can be amended by the controller when signals warrant it — new steps are appended; the index is not reset.

### `step_results: List[StepResult]`

Since this is a plain list, updates replace the entire list. Nodes modifying this field must append their new result to the existing list (`state.get("step_results", []) + [new_result]`). This ensures prior results are not lost, while allowing the credibility scorer to replace the list in-place later. This replaces the pair of `weather_data: str` and `news_data: str` with a typed, extensible accumulator.

### `scratchpad: List[AgentSignal]`

Same replacement semantics as `step_results`. Agents append signals; the controller reads unacted signals after each step. Acted signals are marked `acted_on: True` rather than deleted, preserving the audit trail.

### `retry_counts: dict`

Plain dict. The controller reads and writes it to enforce N-03 (max 2 retries per step). Key: `step_id` (str). Value: int. Initialized to `{}`.

### `augmentation_passes: int`

Counter to prevent infinite outer loops (Diamond 3). Capped at 1. Initialized to `0`.

### `clarification: Optional[ClarificationState]`

`None` when no ambiguity. When the intent parser flags `is_ambiguous: True`, this field is populated with the question to present to the user. The graph pauses at the clarification node until `user_answer` is filled, then re-runs the intent parser with the augmented context.

---

## Backward Compatibility

`main.py` currently constructs:
```python
initial_state: AgentState = {
    "messages": [HumanMessage(content=query)],
    "location": location,
    "intent": "unknown",
    "weather_data": "",
    "news_data": ""
}
```

**Migration:** `main.py` will be updated to construct the new schema. The old fields (`location`, `intent`, `weather_data`, `news_data`) are removed — they have no TypedDict entries in the new schema, so Python will raise a `TypeError` at runtime if the old construction is used (which is correct behavior — fail fast).

New construction in `main.py`:
```python
initial_state: AgentState = {
    "messages": [HumanMessage(content=f"{location}: {query}")],
    "parsed_query": {},
    "clarification": None,
    "research_plan": None,
    "step_results": [],
    "scratchpad": [],
    "retry_counts": {},
    "augmentation_passes": 0,
    "optimist_argument": None,
    "skeptic_argument": None,
    "final_answer": None,
    "answer_confidence": None,
}
```

Location and query are merged into the message. The intent parser extracts location from the natural language context.

---

## State Lifecycle

```
Initial State
    │
    ▼
[Intent Parser] ── populates parsed_query
    │
    ├──[Ambiguous?]──▶ [Clarification Node] ── populates clarification
    │                      │ (user answers)
    │                      ▼
    │                  [Intent Parser] re-runs with answer
    │
    ▼
[Planner] ── populates research_plan
    │
    ▼ (loop per step)
[Executor] ── appends to step_results, scratchpad
    │
    ├──[Signals?]──▶ amends research_plan.steps
    │
    └──[Uncertain?]──▶ increments retry_counts, re-executes step
    │
    ▼
[Credibility Scorer] ── annotates step_results in-place
    │
    ▼
[Debate: Optimist + Skeptic] ── LLM arguments (not stored in state)
    │
    ▼
[Judge] ── populates final_answer, answer_confidence
    │
    ▼
END
```
