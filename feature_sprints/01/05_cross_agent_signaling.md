# Spec 05: Cross-Agent Scratchpad Signaling (Gold 1)

## Problem

In the current architecture, weather and news agents execute in isolation. Neither knows what the other found. If the news agent discovers articles about a hurricane, the weather agent cannot deepen its query to investigate the storm specifically.

This spec adds a shared scratchpad to AgentState and a Signal Handler node that reads pending signals and amends the research plan accordingly.

---

## Mechanism

Each agent, after executing its step, may call `post_signal()` to append an `AgentSignal` to `state["scratchpad"]`.

The executor's routing function checks for unacted signals before advancing to the next step. If signals exist, control passes to the `signal_handler` node, which uses an LLM to decide whether to amend the plan.

---

## When Agents Post Signals

Signals are **not** mandatory. An agent posts a signal only when its result contains information that should materially change subsequent steps.

Triggering conditions (evaluated by each agent via LLM judgment):

| Condition | Signal Type | Example |
|-----------|-------------|---------|
| Result references a major event not in the plan | `amend_plan` | News step finds "Hurricane warnings issued for Austin area" |
| Result is contradicted by a prior step result | `flag_finding` | Weather says "clear skies", news says "storm warning" |
| Result reveals data is unreliable or missing | `warn` | SerpAPI returns cached data from 3 days ago |

---

## Component: Signal Poster (in each agent)

After executing its step and before returning state, each agent runs:

```python
_signal_evaluator = model.with_structured_output(AgentSignal)

SIGNAL_EVALUATOR_PROMPT = """
You are a research coordination agent.

Review the result of the step just completed. Determine if you should post a signal
to the shared scratchpad to influence subsequent research steps.

Post a signal ONLY if:
1. You found a significant fact that other steps should investigate further (amend_plan)
2. Your result directly contradicts a prior step's result (flag_finding)
3. The data source is clearly unreliable or stale (warn)

If none of these conditions apply, respond with signal_type=None.

Available signal targets: controller, weather_agent, news_agent, planner
"""

def maybe_post_signal(state: AgentState, step_result: StepResult) -> list:
    """Evaluate whether to post a signal. Returns list of signals (0 or 1)."""
    prior_results_summary = "\n".join([
        f"- {r['step_id']} ({r['tool']}): {r['raw_data'][:200]}..."
        for r in state.get("step_results", [])
    ])

    context = (
        f"Original query: {state['messages'][0].content}\n"
        f"Current step result:\n{step_result.raw_data}\n\n"
        f"Prior results summary:\n{prior_results_summary or 'None'}"
    )

    # Use a special nullable schema to allow "no signal"
    signal = _signal_evaluator.invoke([
        {"role": "system", "content": SIGNAL_EVALUATOR_PROMPT},
        {"role": "user",   "content": context}
    ])

    if signal.signal_type is None:
        return []

    return [signal.model_dump()]
```

> **Implementation note:** `AgentSignal` needs an optional `signal_type` for this use case. Add `Optional[SignalType]` and a validator: if `signal_type is None`, return early without posting.

---

## Component: Signal Handler Node

**File:** `agents.py`
**Responsibility:** Read all unacted `amend_plan` signals and decide whether to add steps to the current plan.

```python
_plan_amender = model.with_structured_output(ResearchPlan)

SIGNAL_HANDLER_PROMPT = """
You are a research plan amendment agent.

You have received signals from agents who have discovered information requiring
additional investigation. The current research plan is provided.

For each amend_plan signal, decide:
1. Is the requested investigation already covered by remaining plan steps? (skip)
2. Would adding a new step materially improve the final answer? (add it)

Return the updated plan. Do not remove existing steps. Only add new steps.
Maximum total steps: 6. If at limit, skip lower-priority amendments.

New step IDs must follow the pattern: step_N where N continues from the last existing step.
"""

def signal_handler_node(state: AgentState) -> AgentState:
    """Process pending amend_plan signals and update the research plan."""
    scratchpad = state.get("scratchpad", [])
    pending = [s for s in scratchpad if not s.get("acted_on")
               and s.get("signal_type") == "amend_plan"]

    if not pending:
        return state

    plan = ResearchPlan(**state["research_plan"])
    signals_text = "\n".join([
        f"- From {s['from_agent']}: {s['payload']}"
        for s in pending
    ])

    context = (
        f"Original query: {state['messages'][0].content}\n\n"
        f"Current plan steps:\n"
        + "\n".join([
            f"  {step.step_id} ({step.tool}): {step.query}"
            for step in plan.steps
        ]) +
        f"\n\nAmendment signals:\n{signals_text}"
    )

    updated_plan: ResearchPlan = invoke_structured(
        _plan_amender,
        [
            {"role": "system", "content": SIGNAL_HANDLER_PROMPT},
            {"role": "user",   "content": context}
        ],
        ResearchPlan
    )

    # Preserve current_step_idx — don't reset progress
    updated_plan.current_step_idx = plan.current_step_idx

    # Mark all pending signals as acted on
    updated_scratchpad = []
    pending_ids = {id(s) for s in pending}
    for s in scratchpad:
        if id(s) in pending_ids:
            updated_scratchpad.append({**s, "acted_on": True})
        else:
            updated_scratchpad.append(s)

    return {
        **state,
        "research_plan": updated_plan.model_dump(),
        "scratchpad": updated_scratchpad,
    }
```

---

## Example Signal Flow

```
Execution: step_1 (weather_search for Austin)
  Result: "Currently 78°F, isolated thunderstorms developing by 8pm"
  
  Agent evaluates → posts signal:
    {
      from_agent: "executor_step_1",
      to_agent: "controller",
      signal_type: "amend_plan",
      payload: "Weather result shows thunderstorms developing at 8pm.
                Recommend adding news_search for storm warnings and
                event cancellations specifically at 8pm timeframe."
    }

Signal Handler receives signal →
  Calls plan amender LLM →
  Adds step_3: news_search("Austin outdoor events cancelled thunderstorm 8pm")

Executor continues with amended plan:
  step_2: news_search (original)
  step_3: news_search (new — storm-specific)
```

---

## Routing Integration

```python
# graph.py — updated route_executor

def route_executor(state: AgentState) -> str:
    plan = ResearchPlan(**state["research_plan"])
    scratchpad = state.get("scratchpad", [])
    
    pending_amendments = [
        s for s in scratchpad
        if not s.get("acted_on") and s.get("signal_type") == "amend_plan"
    ]
    
    if pending_amendments:
        return "signal_handler"
    
    if plan.is_complete():
        return "credibility_scorer"
    
    return "executor"

# After signal_handler, always return to executor
workflow.add_edge("signal_handler", "executor")
```

---

## Sequence Diagram

```
Executor          Scratchpad        Signal Handler    Executor (next step)
   │                  │                  │                  │
   │──[step result]   │                  │                  │
   │──[evaluate]      │                  │                  │
   │──[post signal]──▶│                  │                  │
   │                  │                  │                  │
   │──[route check]   │                  │                  │
   │──[pending?]─────────────────────────│                  │
   │                  │◀──[read pending]─│                  │
   │                  │                  │──[LLM amend]     │
   │                  │                  │──[update plan]   │
   │                  │                  │──[mark acted]───▶│
   │                  │                  │                  │──[step N+1]
```
