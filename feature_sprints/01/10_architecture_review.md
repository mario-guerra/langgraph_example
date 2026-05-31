# Architecture Review: Sprint 01 (Adaptive Intelligence Upgrade) | Status: APPROVED (Revisions Applied)

## Executive Summary
The spec proposes a highly ambitious, agentic redesign that successfully moves logic out of hardcoded graph edges and into LLM-driven planning and evaluation. The Plan-Execute core and credibility scoring are strong structural additions. However, the plan fails pre-flight verification on framework mechanics (LangGraph streaming and state reducers), introduces a brittle data-mangling hack for the debate stage, and includes a naive retry pattern that is guaranteed to fail in production. It needs a revision pass before implementation.

## Critical Issues (Must Fix)

1. **LangGraph Streaming Misconception**: F-10 (Spec 00) / Phase 3 (Spec 09) | Problem: The plan assumes replacing `graph.invoke()` with `graph.stream()` will stream LLM output tokens to the CLI. This is false. `graph.stream()` yields node state updates (dictionaries), not LLM tokens. | Impact: The core non-functional requirement for a responsive CLI will fail. | Specific Recommendation: Use `.stream(stream_mode="messages")` and implement a message chunk handler, or use `astream_events` from `langchain_core` to properly stream LLM tokens.

2. **State Reducer Contradiction (Data Loss Bug)**: Spec 01 vs Spec 04 vs Spec 06 | Problem: Spec 01 defines `step_results` with an `add` reducer. Spec 06 correctly notes that `add` prevents in-place credibility updates and suggests using a plain list (which replaces state). However, Spec 04's `executor_node` returns `{"step_results": [step_result]}` assuming the `add` reducer is still active. | Impact: If implemented as a plain list, the executor will overwrite all previous results on every step, erasing the research history. | Specific Recommendation: Make `step_results` a plain list (no reducer) in `AgentState`, and update `executor_node` to explicitly append: `{"step_results": state.get("step_results", []) + [step_result.model_dump()]}`.

3. **Naive Retry Anti-Pattern**: Spec 03 (`invoke_structured` helper) | Problem: The retry loop catches structured output validation errors, sleeps, and resends the *exact same messages* to the LLM. For a low-temperature model, this will deterministically produce the exact same invalid output 3 times in a row. | Impact: Pydantic validation failures will simply hang the system for 7 seconds and crash, rather than recovering. | Specific Recommendation: When catching an exception, append a `HumanMessage(content=f"Validation failed: {str(e)}. Fix the output.")` to the message list before retrying, or use Langchain's built-in `with_retry()` or `RetryOutputParser`.

4. **Infinite Augmentation Loop**: Spec 07 (Evidence Evaluator) | Problem: The `evidence_evaluator_node` can append augmentation steps and route back to the executor. Once the new steps finish, it routes back to the evaluator. There is no mechanism to stop the evaluator from generating more augmentation steps forever if the LLM remains unsatisfied. | Impact: Potential infinite loop exhausting API credits. | Specific Recommendation: Add an `augmentation_passes: int` field to `AgentState` (default 0). The evaluator may only return `augment` if `augmentation_passes < 1`.

## Major/Minor Issues

1. **YAGNI: The `depends_on` Field**: Spec 02 (PlanStep) | Problem: The Planner generates a topological DAG using `depends_on`, but the Executor runs strictly sequentially via `plan.advance()`. Since async/parallel execution is explicitly "Out of Scope" (Spec 00), asking the LLM to generate dependencies wastes tokens and context window for an unused feature. | Recommendation: Remove `depends_on` from `PlanStep`. Instruct the planner to simply order the steps logically.
2. **Scratchpad Overload (Inner Platform)**: Spec 08 (Debate) | Problem: The Optimist and Skeptic agents write their arguments to the `scratchpad` using string-mangled prefixes (`OPTIMIST_ARGUMENT:`), which the Judge then parses back out. The scratchpad is meant for mid-execution routing signals, not storing final state artifacts. | Recommendation: Add explicit `optimist_argument: Optional[str]` and `skeptic_argument: Optional[str]` fields to `AgentState`. 

## Questions & Risks

1. **Token Limits**: Stacking raw SerpAPI results, credibility annotations, and prior debate arguments into the Judge's context window could push limits for complex queries. Should the raw results be summarized before the debate stage?
2. **Error Handling**: What happens if the SerpAPI key is invalid or rate-limited during a step? Does `confidence=0.0` properly trigger an early exit, or will the system endlessly try to augment the failure?
