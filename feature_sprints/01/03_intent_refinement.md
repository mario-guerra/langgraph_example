# Spec 03: Intent Refinement (Gold 3)

## Problem

The current coordinator uses this:

```python
# agents.py — CURRENT (line 21–31)
has_weather = any(word in user_message for word in ["weather", "temperature", ...])
has_news    = any(word in user_message for word in ["news", "headlines", ...])
```

This is not LLM reasoning. It is grep. It cannot handle:
- "Should I go to the outdoor concert tonight?" (implicit weather + events query)
- "What's happening in Austin?" (genuinely ambiguous — could be news, events, weather)
- "Is it safe to drive tomorrow?" (weather + traffic — topics not in the keyword list)
- Time references: "this weekend", "tomorrow morning"

The intent parser replaces ALL of this.

---

## Component: Intent Parser

**File:** `agents.py` (replaces `coordinator_agent`)
**Responsibility:** Extract structured intent from freeform natural language using `model.with_structured_output(IntentSchema)`.

### LLM Call

```python
from schemas import IntentSchema

_intent_parser = model.with_structured_output(IntentSchema)

INTENT_SYSTEM_PROMPT = """
You are an intent extraction engine for a research assistant.

Given a user query, extract:
1. location — the geographic location the user is asking about. Fully resolve abbreviations
   (NYC → New York, NY). Empty string if no location is mentioned.
2. topics — a list of research topics. Do not limit to weather/news. Use your judgment:
   - "Should I go to the concert?" → ["weather", "local_events"]
   - "Is it safe to drive?" → ["weather", "traffic", "road_conditions"]
   - "What's the situation?" → flag as ambiguous
3. time_range — temporal scope: "now", "today", "tonight", "this_week", "unspecified"
4. is_ambiguous — True only when multiple distinct interpretations would lead to
   meaningfully different research plans. "What's the weather?" is NOT ambiguous even
   without a location (location is simply missing, which is handled separately).
5. ambiguity_reason — required when is_ambiguous=True. One sentence.

Be conservative with is_ambiguous=True. Only flag genuine semantic ambiguity,
not missing information.
"""

def parse_intent(state: AgentState) -> AgentState:
    """Intent parser node — replaces coordinator_agent."""
    messages = state["messages"]
    user_message = messages[-1].content if messages else ""

    # If we have a clarification answer, append it to context
    clarification = state.get("clarification")
    if clarification and not clarification.awaiting_response and clarification.user_answer:
        user_message = (
            f"Original query: {messages[0].content}\n"
            f"Clarification: {clarification.user_answer}"
        )

    result: IntentSchema = _intent_parser.invoke([
        {"role": "system", "content": INTENT_SYSTEM_PROMPT},
        {"role": "user",   "content": user_message}
    ])

    return {
        **state,
        "parsed_query": result.model_dump(),
        "clarification": None  # Reset — will be re-set if still ambiguous
    }
```

---

## Component: Clarification Question Generator

**File:** `agents.py`
**Responsibility:** When `parsed_query.is_ambiguous == True`, generate exactly one targeted question.

```python
from schemas import ClarificationSchema, ClarificationState

_clarification_generator = model.with_structured_output(ClarificationSchema)

CLARIFICATION_SYSTEM_PROMPT = """
You are a clarification agent. The user's query is ambiguous in a specific way.
Generate exactly ONE targeted question that, when answered, fully resolves the ambiguity.
Do not ask multiple questions. Do not ask for information you can infer.
The question must be answerable in one or two sentences.
"""

def generate_clarification(state: AgentState) -> AgentState:
    """Clarification node — only reached when is_ambiguous=True."""
    parsed = state["parsed_query"]
    user_message = state["messages"][0].content

    result: ClarificationSchema = _clarification_generator.invoke([
        {"role": "system", "content": CLARIFICATION_SYSTEM_PROMPT},
        {"role": "user",   "content": (
            f"User query: {user_message}\n"
            f"Detected ambiguity: {parsed['ambiguity_reason']}"
        )}
    ])

    clarification = ClarificationState(
        question=result.question,
        awaiting_response=True,
        user_answer=None
    )

    # Print the question to the user (CLI integration point)
    print(f"\n❓ {result.question}")

    return {**state, "clarification": clarification.model_dump()}
```

---

## Graph Routing for Intent + Clarification

```python
# graph.py routing logic

def route_after_intent(state: AgentState) -> str:
    parsed = state.get("parsed_query", {})
    clarification = state.get("clarification")

    if parsed.get("is_ambiguous") and not (
        clarification and not clarification.get("awaiting_response")
    ):
        return "clarification_node"

    return "planner"

def route_after_clarification(state: AgentState) -> str:
    """After the user answers, go back to intent parser."""
    return "intent_parser"
```

---

## Graph Nodes and Edges

```
START
  │
  ▼
[intent_parser]
  │
  ├──[is_ambiguous=True, no answer yet]──▶ [clarification_node] ──▶ [wait for user input]
  │                                               │ (user_answer filled in main.py)
  │                                               ▼
  │                                         [intent_parser] ← re-run
  │
  └──[not ambiguous OR answer received]──▶ [planner]
```

### CLI Integration (main.py)

When the graph pauses at `clarification_node`, `main.py` must detect the `awaiting_response` flag, prompt the user, inject the answer, and re-invoke:

```python
# main.py — new loop body
result = research_graph.invoke(initial_state)

# Check if waiting for clarification
while result.get("clarification", {}).get("awaiting_response"):
    question = result["clarification"]["question"]
    answer = input(f"\n❓ {question}\nYour answer: ").strip()

    # Inject answer and continue
    result["clarification"]["awaiting_response"] = False
    result["clarification"]["user_answer"] = answer
    result = research_graph.invoke(result)
```

---

## Retry Policy (N-02)

The `model.with_structured_output()` call validates against `IntentSchema`. If Pydantic validation fails:
- Retry up to 3 times with exponential backoff (1s, 2s, 4s)
- On third failure, fall back to a safe default: `topics=["general"], is_ambiguous=False`
- Log the failure prominently

This is handled by wrapping in a utility function:

```python
import time
from typing import TypeVar, Type
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

def invoke_structured(model_with_output, messages: list, schema: Type[T], max_retries=3) -> T:
    from pydantic import ValidationError
    from langchain_core.exceptions import OutputParserException
    
    current_messages = list(messages)
    for attempt in range(max_retries):
        try:
            return model_with_output.invoke(current_messages)
        except (ValidationError, OutputParserException) as e:
            if attempt == max_retries - 1:
                raise
            
            # Feed the error back to the LLM so it can correct the mistake
            current_messages.append(HumanMessage(
                content=f"Validation failed: {str(e)}\n\nPlease fix the format and try again."
            ))
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

---

## Sequence Diagram

```
User         CLI/main.py      intent_parser    clarification_node
 │               │                 │                   │
 │──[query]─────▶│                 │                   │
 │               │──[invoke]──────▶│                   │
 │               │                 │──[LLM call]       │
 │               │                 │    IntentSchema   │
 │               │◀──[state]───────│  (is_ambiguous)   │
 │               │                 │                   │
 │               │──────────────────────────────────── ▶│
 │               │                 │                   │──[LLM call]
 │               │                 │                   │   ClarificationSchema
 │◀──[question]──│◀────────────────────────────────────│
 │──[answer]────▶│                 │                   │
 │               │──[re-invoke]───▶│                   │
 │               │                 │──[LLM call]       │
 │               │                 │    IntentSchema   │
 │               │                 │    (resolved)     │
 │               │──[to planner]──▶│                   │
```
