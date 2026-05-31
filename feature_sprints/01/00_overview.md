# Sprint 01: Adaptive Intelligence Upgrade
## Executive Summary

**Purpose:** Transform the langgraph_example from a keyword-router with LLM text formatting into a genuinely intelligent multi-agent system where the LLM drives all non-trivial decisions.

**Scope — In:**
- Replace keyword-based coordinator with LLM-structured intent + entity extraction
- Implement Plan-Execute runtime (LLM-generated dynamic research plans)
- Add uncertainty-driven adaptive loops (real graph cycles)
- Add multi-agent debate + judge synthesis
- Add cross-agent scratchpad signaling (bottom-up plan amendment)
- Add source credibility scoring before synthesis
- Add intent refinement via clarifying questions (pre-planning)

**Scope — Out:**
- No new external data sources beyond SerpAPI
- No persistent storage / Redis caching
- No async/parallel agent execution
- No web UI (Streamlit/FastAPI deferred)
- No LangSmith tracing integration (deferred)

**Ownership:** Solo (mario-guerra)
**Status:** DRAFT — ready for implementation

---

## The Core Problem Being Fixed

The current architecture is embarrassed by this fact: you could delete the LLM from the coordinator, weather agent, and news agent and replace each with `printf()` — and the routing behavior would be **identical**. The LLM is only used for final text formatting. That is not a multi-agent system; it is a switch statement.

The goal of this sprint is to make the LLM the **decision engine** at every non-trivial step, not just the sentence writer.

---

## Requirements

### Functional

| ID | Requirement |
|----|-------------|
| F-01 | System MUST use an LLM call with structured output to classify intent and extract entities (location, topic, time_range) from freeform natural language queries |
| F-02 | A Planner LLM MUST generate a typed, ordered research plan (list of steps with dependencies) before any tool is invoked |
| F-03 | Execution MUST follow the planner's step list; agents MUST NOT be hardcoded nodes that always fire |
| F-04 | Each agent/tool output MUST include a `confidence` score (0.0–1.0) and `evidence_quality` (low/medium/high) alongside raw data |
| F-05 | A meta-routing agent MUST evaluate uncertainty after each step and decide: accept, retry with amended query, or escalate to clarifying question |
| F-06 | Agents MUST be able to post signals to a shared scratchpad; the execution controller MUST check signals after each step and amend the plan if warranted |
| F-07 | A credibility scoring step MUST run before synthesis, annotating each source with authority, recency, and contradiction flags |
| F-08 | At synthesis stage, two adversarial sub-agents (Optimist, Skeptic) MUST argue their interpretation; a Judge LLM MUST produce a calibrated final answer |
| F-09 | When the Planner detects genuine ambiguity (not keyword matching), the system MUST generate exactly one clarifying question and wait for user response before planning |
| F-10 | The CLI MUST stream output tokens as they arrive using LangGraph's `.stream(stream_mode="messages")` or LangChain's `astream_events` (replacing `.invoke()` at the top level) |

### Non-Functional

| ID | Requirement |
|----|-------------|
| N-01 | End-to-end latency for a single-topic unambiguous query MUST be ≤ 30 seconds on a standard internet connection (SerpAPI RTT included) |
| N-02 | Each LLM structured-output call MUST have a retry limit of 3 with exponential backoff before raising to the user |
| N-03 | Uncertainty loop MUST terminate after at most 2 iterations per step to prevent infinite cycles |
| N-04 | All new LLM calls MUST use `model.with_structured_output(PydanticSchema)` — no raw string parsing |
| N-05 | All Pydantic schemas MUST use `model_validator` to enforce field-level invariants (e.g., confidence ∈ [0.0, 1.0]) |
| N-06 | The new `AgentState` MUST be backward-compatible with the existing `main.py` entry point signature |
| N-07 | `requirements.txt` additions MUST be pinned to minor versions (e.g., `pydantic>=2.0,<3.0`) |

---

## File Map: Current → New

```
langgraph_example/
├── state.py          ← REPLACE: major expansion
├── agents.py         ← REPLACE: all agents rewritten
├── graph.py          ← REPLACE: dynamic plan-execute runtime
├── tools.py          ← AUGMENT: add credibility scorer
├── config.py         ← UNCHANGED
├── main.py           ← AUGMENT: switch to .stream()
├── demo.py           ← AUGMENT: richer test cases
├── planner.py        ← NEW: Plan-Execute planner
├── schemas.py        ← NEW: all Pydantic output schemas
├── debate.py         ← NEW: Optimist/Skeptic/Judge
└── requirements.txt  ← AUGMENT: pydantic pin
```

---

## Architecture Context Diagram (C4 Level 1)

```
┌─────────────────────────────────────────────────────────┐
│                   langgraph_example                      │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌───────────────────┐  │
│  │   User   │───▶│  CLI /   │───▶│  LangGraph        │  │
│  │ (human)  │◀───│ main.py  │◀───│  Research Graph   │  │
│  └──────────┘    └──────────┘    └───────────────────┘  │
│                                          │               │
│                          ┌───────────────┤               │
│                          ▼               ▼               │
│                   ┌────────────┐  ┌────────────┐        │
│                   │ Google     │  │  SerpAPI   │        │
│                   │ Gemini LLM │  │  (search)  │        │
│                   └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────┘
```

---

## Spec Index

| File | Topic |
|------|-------|
| `01_state_design.md` | Expanded AgentState schema |
| `02_schemas.md` | All Pydantic structured-output schemas |
| `03_intent_refinement.md` | Gold 3: Clarifying questions before planning |
| `04_plan_execute.md` | Diamond 1: LLM-generated research plans |
| `05_cross_agent_signaling.md` | Gold 1: Scratchpad + plan amendment |
| `06_credibility_scoring.md` | Gold 2: Source credibility before synthesis |
| `07_uncertainty_loops.md` | Diamond 3: Adaptive retry loops |
| `08_debate_judge.md` | Diamond 2: Adversarial synthesis |
| `09_implementation_plan.md` | Phases, milestones, risks, estimates |
