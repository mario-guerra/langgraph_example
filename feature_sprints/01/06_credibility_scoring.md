# Spec 06: Source Credibility Scoring (Gold 2)

## Problem

The current system feeds SerpAPI results directly to the LLM as raw strings, with zero evaluation of source quality. A result from a 3-week-old tabloid blog gets the same weight as a current NWS alert. The LLM has no signal about which sources to trust.

This spec adds a credibility scoring step that annotates each `StepResult` before synthesis. The debate agents and judge receive credibility-weighted inputs.

---

## When It Runs

After all plan steps complete (the executor loop ends), before the debate stage:

```
[executor loop complete] → [credibility_scorer] → [debate: optimist/skeptic] → [judge]
```

---

## Component: Credibility Scorer

**File:** `tools.py` (or a new `credibility.py` — prefer the latter to keep tools.py clean)
**New file:** `credibility.py`

```python
from langchain_core.messages import SystemMessage, HumanMessage
from schemas import StepResult, CredibilityAnnotation, EvidenceQuality
from state import AgentState
from typing import List

_credibility_scorer = model.with_structured_output(List[CredibilityAnnotation])

CREDIBILITY_SYSTEM_PROMPT = """
You are a source credibility analyst for a research system.

For each search result provided, score it on three dimensions (0.0 to 1.0):

1. authority_score: How authoritative is the source?
   - 1.0: Official government, academic, major national news outlet (NWS, AP, Reuters, NYT, NOAA)
   - 0.7: Regional news outlet, established local paper
   - 0.5: General web content from known organizations
   - 0.3: Unknown blogs, aggregators, unattributed content
   - 0.1: Clearly unverified or suspect sources

2. recency_score: How recent is the information?
   - 1.0: Published/updated within the last 2 hours
   - 0.8: Within 24 hours
   - 0.6: Within 48 hours
   - 0.4: Within the week
   - 0.2: More than a week old
   - 0.0: Undated or clearly stale

3. relevance_score: How directly does this result address the research step's rationale?
   - 1.0: Directly and completely answers the step
   - 0.7: Mostly relevant with some tangential content
   - 0.5: Partially relevant
   - 0.2: Tangential — mentions the topic but doesn't address it
   - 0.0: Irrelevant

Also identify contradicts_step_ids: list any other step IDs whose results this
result contradicts. Leave empty if no contradiction detected.

Extract the source name/domain from the result text if available.
If the source cannot be determined, use "unknown".
"""

def credibility_scorer_node(state: AgentState) -> AgentState:
    """Score the credibility of all step results before synthesis."""
    step_results = state.get("step_results", [])

    if not step_results:
        return state

    # Build scoring context — include step rationale for relevance scoring
    plan = state.get("research_plan", {})
    steps_by_id = {}
    if plan:
        from schemas import ResearchPlan
        rp = ResearchPlan(**plan)
        steps_by_id = {s.step_id: s for s in rp.steps}

    results_context = []
    for i, result_dict in enumerate(step_results):
        result = StepResult(**result_dict)
        step_meta = steps_by_id.get(result.step_id)
        rationale = step_meta.rationale if step_meta else "No rationale available"

        results_context.append(
            f"--- Result {i+1} (step_id: {result.step_id}) ---\n"
            f"Step rationale: {rationale}\n"
            f"Tool: {result.tool}\n"
            f"Content:\n{result.raw_data[:600]}"
        )

    context_text = "\n\n".join(results_context)

    annotations: List[CredibilityAnnotation] = invoke_structured(
        _credibility_scorer,
        [
            SystemMessage(content=CREDIBILITY_SYSTEM_PROMPT),
            HumanMessage(content=context_text)
        ],
        List[CredibilityAnnotation]
    )

    # Map annotations back to step_results by index
    # (LLM returns one annotation per result, in order)
    updated_results = []
    for i, result_dict in enumerate(step_results):
        result = StepResult(**result_dict)
        if i < len(annotations):
            annotation = annotations[i]
            result.credibility = [annotation]

            # Upgrade/downgrade evidence_quality based on credibility
            avg_score = (
                annotation.authority_score +
                annotation.recency_score +
                annotation.relevance_score
            ) / 3.0

            if avg_score >= 0.7:
                result.evidence_quality = EvidenceQuality.high
            elif avg_score >= 0.45:
                result.evidence_quality = EvidenceQuality.medium
            else:
                result.evidence_quality = EvidenceQuality.low

            # Refine confidence score based on credibility
            result.confidence = min(result.confidence * (avg_score + 0.3), 1.0)

        updated_results.append(result.model_dump())

    return {**state, "step_results": updated_results}
```

> **Reducer note:** `step_results` uses an `add` reducer. Replacing the list in-place won't work — the reducer will *append* the updated results to the existing ones, creating duplicates. **Solution:** Change `step_results` reducer from `add` to a custom `replace_list` reducer (like `scratchpad` above). Or: use a sentinel pattern where updated results replace by step_id. The cleanest solution is a custom reducer:

```python
# state.py — custom reducer for mutable lists
def replace_list(existing: list, update: list) -> list:
    """Replace the list entirely when a full list is provided."""
    if update is not None:
        return update
    return existing

# In AgentState:
step_results: Annotated[List[StepResult], replace_list]
```

> This is a **breaking change from the `add` reducer** and must be coordinated with the executor (which appends by returning `[new_result]`). **Resolution:** Use a dict-keyed accumulator instead of a list, or switch to an explicit append helper that returns the full list. Simplest safe choice: make step_results a plain list (no reducer) and have each node that modifies it return the full updated list.

---

## Credibility Report Format (for debate stage)

Before handing off to debate, the credibility scorer generates a human-readable summary for the debate context:

```python
def build_credibility_report(step_results: list) -> str:
    """Format credibility annotations as context for debate agents."""
    lines = []
    for r in step_results:
        result = StepResult(**r)
        cred = result.credibility[0] if result.credibility else None
        if cred:
            lines.append(
                f"[{result.step_id}] Source: {cred.source} | "
                f"Authority: {cred.authority_score:.1f} | "
                f"Recency: {cred.recency_score:.1f} | "
                f"Relevance: {cred.relevance_score:.1f} | "
                f"Quality: {result.evidence_quality.value} | "
                f"Confidence: {result.confidence:.2f}"
                + (f" | ⚠️ Contradicts: {cred.contradicts_step_ids}" if cred.contradicts_step_ids else "")
            )
        else:
            lines.append(f"[{result.step_id}] No credibility data")
    return "\n".join(lines)
```

---

## Example Credibility Output

```
[step_1] weather_search result:
  Source: weather.com | Authority: 0.6 | Recency: 1.0 | Relevance: 0.9
  Evidence Quality: HIGH → Confidence: 0.87

[step_2] news_search result:
  Source: unknown blog | Authority: 0.2 | Recency: 0.4 | Relevance: 0.7
  Evidence Quality: LOW → Confidence: 0.28
  ⚠️ Contradicts: [step_1] — this article claims sunny skies while step_1 shows storm warnings

[step_3] news_search result:
  Source: nws.noaa.gov | Authority: 1.0 | Recency: 0.9 | Relevance: 1.0
  Evidence Quality: HIGH → Confidence: 0.97
```

The debate stage receives this report explicitly. The skeptic will immediately attack step_2's credibility. The judge will weight step_1 and step_3 far more heavily.

---

## Non-Functional Requirements

| Req | Spec |
|-----|------|
| N-04 | Uses `model.with_structured_output(List[CredibilityAnnotation])` |
| N-02 | Retry up to 3x with backoff via `invoke_structured()` |
| Latency | Credibility scoring adds ~1 LLM call. Acceptable given it runs once, not per-step |
| Fallback | If scoring fails after 3 retries, set all credibility to `None` and proceed — debate agents will note the absence |
