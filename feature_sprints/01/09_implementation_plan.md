# Spec 09: Implementation Plan & Risk Analysis

## Executive Summary

This document outlines the phased implementation strategy for the Adaptive Intelligence Upgrade (Sprint 01). The approach minimizes blast radius by replacing the graph topology last, building and testing the leaf nodes (schemas, tools, agents) in isolation first.

---

## Phasing & Milestones

### Phase 1: Foundation (Data Structures & Tools)
**Goal:** Establish the strict types and raw capabilities required by the new architecture.

1. Update `requirements.txt` (`pydantic>=2.0,<3.0`)
2. Create `schemas.py` and implement all 10 Pydantic models (Spec 02)
3. Update `state.py` to the new `AgentState` design (Spec 01), including the custom `replace_list` reducer if chosen over dicts.
4. Augment `tools.py` with `web_search` (Spec 04).

**Milestone 1:** `python -c "import schemas, state, tools"` runs without error, all Pydantic validators pass static type checks.

### Phase 2: Core Reasoning Nodes
**Goal:** Implement the isolated LLM reasoning functions. These can be unit tested outside of LangGraph.

1. Create `planner.py` (Spec 04)
2. Create `credibility.py` (Spec 06)
3. Create `debate.py` (Optimist, Skeptic, Judge) (Spec 08)
4. Rewrite `agents.py`:
   - `intent_parser` & `generate_clarification` (Spec 03)
   - `executor_node` with per-step uncertainty (Spec 04)
   - `maybe_post_signal` & `signal_handler_node` (Spec 05)
   - `evidence_evaluator_node` (Spec 07)

**Milestone 2:** Each node function can be invoked independently with a mock `AgentState` and returns a valid modified state.

### Phase 3: Graph Orchestration & CLI
**Goal:** Wire the nodes together into the dynamic runtime and update the user interface.

1. Rewrite `graph.py` to implement the new routing logic:
   - Intent → Clarification loop
   - Plan-Execute loop
   - Signal handling interruptions
   - Credibility → Debate → Judge pipeline
2. Update `main.py` (Spec 03 / Spec 04):
   - Handle the `clarification` state pause for user input
   - Switch from `.invoke()` to `.stream(stream_mode="messages")` to render intermediate node outputs and the final answer token-by-token, as `graph.stream()` alone only yields state updates.
3. Update `demo.py` to include the complex, ambiguous test cases ("Should I drive to Austin tonight?").

**Milestone 3 (Final):** End-to-end execution of a complex multi-topic query via `python demo.py`.

---

## Cross-Boundary Impact Analysis

This sprint entirely rewrites the internals of `langgraph_example`. 

**Impacts:**
- **State Structure:** `AgentState` is completely overhauled. Any external consumers expecting `state["weather_data"]` will break.
- **CLI Interaction:** `main.py` is updated to handle multi-turn clarification. Scripts wrapping the CLI via `pexpect` or `subprocess` may hang if they do not expect the clarification prompt (`❓ ... Your answer:`).
- **Latency:** The new architecture chains significantly more LLM calls (Intent -> Planner -> Executor(s) -> Credibility -> Debate -> Judge). Latency will increase from ~3s to ~15-25s. The transition to `.stream()` in the CLI is critical to mask this latency from the user.

---

## Technical Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Infinite Loops** in Plan-Execute or Uncertainty cycles | High | Medium | 1. Hardcode max step count in Planner prompt.<br>2. Enforce max 2 retries per step in `retry_counts`.<br>3. Cap max overall graph recursion in `workflow.compile(recursion_limit=...)`. |
| **Context Window Exhaustion** | Medium | Low (Gemini Flash has 1M+) | Truncate raw SerpAPI results before feeding to agents. Only pass necessary context. |
| **Structured Output parsing failures** | Medium | Medium | Wrap all structured output calls in a retry loop with exponential backoff (N-02). |
| **Scratchpad Reducer Mutation** | High | Medium | Python list mutation with `operator.add` causes duplicate accumulation. Fix: use a custom `replace_list` reducer in `state.py` for the scratchpad and `step_results`. |

---

## Confidence-Weighted Estimates

- **Phase 1 (Foundation):** 2 hours (High confidence)
- **Phase 2 (Reasoning Nodes):** 6 hours (Medium confidence — prompt tuning takes time)
- **Phase 3 (Graph & CLI):** 4 hours (Medium-High confidence)
- **Total Estimate:** 12 hours (1.5 days)
