# Spec 07: Uncertainty-Driven Adaptive Loops (Diamond 3)

## Note: Partial Coverage in Spec 04

The per-step uncertainty evaluation (retry/accept/escalate decision) is specified in Spec 04 (Plan-Execute) as part of the executor node. That is correct — uncertainty drives the inner loop *within* step execution.

This spec covers the **outer uncertainty evaluation**: after ALL steps complete, before synthesis, a meta-evaluator assesses whether the full evidence set is sufficient to answer the user's query. If not, it can:
1. Add new steps to the plan (triggers another executor iteration)
2. Accept and proceed to synthesis despite gaps (noting them explicitly)

This is distinct from per-step retry (max 2x, in Spec 04). The outer evaluation runs once.

---

## Component: Evidence Sufficiency Evaluator

**File:** `agents.py`
**Position in graph:** After credibility scorer, before debate

```python
_evidence_evaluator = model.with_structured_output(EvidenceSufficiencyDecision)

EVIDENCE_EVALUATOR_PROMPT = """
You are a research completeness auditor.

Given:
- The user's original query
- All collected research results with their credibility scores
- The original research plan

Evaluate: Is the evidence collected sufficient to give a reliable, complete answer?

Consider:
1. Are all topics from the parsed intent covered by at least one high-quality result?
2. Are there contradictions between results that remain unresolved?
3. Are there obvious gaps that a simple additional search could fill?
4. Is the overall confidence of the evidence set adequate (average ≥ 0.5)?

Decision options:
- proceed: Evidence is sufficient. Go to synthesis.
- augment: A specific gap exists that warrants 1-2 additional searches.
            Provide the augmentation_steps (max 2 new steps).
- proceed_with_caveats: Evidence is thin but additional searches are unlikely to help.
                        Note the gaps explicitly — the judge will flag them.
"""

class AugmentStep(BaseModel):
    tool: Literal["weather_search", "news_search", "web_search"]
    query: str
    location: str
    rationale: str

class EvidenceSufficiencyDecision(BaseModel):
    decision: Literal["proceed", "augment", "proceed_with_caveats"]
    coverage_gaps: List[str] = Field(
        default_factory=list,
        description="Topics from the original query not adequately covered."
    )
    contradiction_summary: Optional[str] = Field(
        default=None,
        description="Summary of detected contradictions, if any."
    )
    augmentation_steps: List[AugmentStep] = Field(
        default_factory=list,
        description="Required when decision=augment. Max 2 steps."
    )
    overall_confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_augment(self) -> "EvidenceSufficiencyDecision":
        if self.decision == "augment" and not self.augmentation_steps:
            raise ValueError("augmentation_steps required when decision=augment")
        if len(self.augmentation_steps) > 2:
            raise ValueError("Maximum 2 augmentation steps")
        return self

def evidence_evaluator_node(state: AgentState) -> AgentState:
    """Outer uncertainty evaluation after all plan steps complete."""
    step_results = state.get("step_results", [])
    parsed_query = state.get("parsed_query", {})

    credibility_report = build_credibility_report(step_results)
    results_summary = "\n\n".join([
        f"[{r['step_id']}] {r['tool']}:\n{r['raw_data'][:400]}"
        for r in step_results
    ])

    context = (
        f"Original query: {state['messages'][0].content}\n"
        f"Topics to cover: {', '.join(parsed_query.get('topics', []))}\n\n"
        f"Credibility Report:\n{credibility_report}\n\n"
        f"Evidence Collected:\n{results_summary}"
    )

    decision: EvidenceSufficiencyDecision = invoke_structured(
        _evidence_evaluator,
        [
            {"role": "system", "content": EVIDENCE_EVALUATOR_PROMPT},
            {"role": "user",   "content": context}
        ],
        EvidenceSufficiencyDecision
    )

    if decision.decision == "augment":
        # Prevent infinite augmentation loops
        if state.get("augmentation_passes", 0) >= 1:
            decision.decision = "proceed_with_caveats"
        else:
            # Inject augmentation steps into the plan and loop back to executor
            plan = ResearchPlan(**state["research_plan"])
            existing_count = len(plan.steps)
            for i, aug in enumerate(decision.augmentation_steps):
                new_step = PlanStep(
                    step_id=f"step_{existing_count + i + 1}_aug",
                    tool=aug.tool,
                    query=aug.query,
                    location=aug.location,
                    rationale=aug.rationale
                )
                plan.append_step(new_step)

            return {
                **state,
                "research_plan": plan.model_dump(),
                "augmentation_passes": state.get("augmentation_passes", 0) + 1,
                # coverage_gaps stored in scratchpad as a warn signal for the judge
                "scratchpad": state.get("scratchpad", []) + [{
                    "from_agent": "evidence_evaluator",
                    "to_agent": "any",
                    "signal_type": "flag_finding",
                    "payload": f"Coverage gaps: {decision.coverage_gaps}. "
                               f"Contradictions: {decision.contradiction_summary}",
                    "acted_on": False
                }]
            }

    # proceed or proceed_with_caveats — store gaps for judge
    caveat_signal = None
    if decision.coverage_gaps or decision.contradiction_summary:
        caveat_signal = {
            "from_agent": "evidence_evaluator",
            "to_agent": "any",
            "signal_type": "flag_finding",
            "payload": (
                f"Evidence caveats — "
                f"Gaps: {decision.coverage_gaps}. "
                f"Contradictions: {decision.contradiction_summary}. "
                f"Overall confidence: {decision.overall_confidence:.2f}"
            ),
            "acted_on": False
        }

    updated_scratchpad = state.get("scratchpad", [])
    if caveat_signal:
        updated_scratchpad = updated_scratchpad + [caveat_signal]

    return {**state, "scratchpad": updated_scratchpad}
```

---

## Graph Routing

```python
def route_evidence_evaluator(state: AgentState) -> str:
    """After outer evidence evaluation, go to executor (if augmenting) or debate."""
    plan = ResearchPlan(**state["research_plan"])
    if not plan.is_complete():
        return "executor"   # Augmentation steps added — loop back
    return "debate_optimist"
```

---

## Relationship to Per-Step Retry (Spec 04)

| Layer | Location | Trigger | Max Iterations |
|-------|----------|---------|----------------|
| Per-step retry | executor_node | Result quality too low for this specific step | 2 retries per step |
| Outer sufficiency | evidence_evaluator_node | Full evidence set has coverage gaps | 1 augmentation pass (max 2 new steps) |
| Hard stop | graph routing | Plan step count ≥ 6 | Enforced in plan amender (Spec 05) |

The two layers are independent. A step can be retried twice and still produce a low-confidence result — the outer evaluator then decides whether that gap warrants augmentation or acceptance with caveats.

---

## Sequence Diagram

```
Executor Loop      Credibility Scorer    Evidence Evaluator     Debate
      │                    │                    │                 │
      │──[all steps done]──▶│                   │                 │
      │                    │──[score all]        │                 │
      │                    │──[annotate]─────────▶│               │
      │                    │                    │──[LLM eval]     │
      │                    │                    │                 │
      │                    │                    │──[augment?]     │
      │◀───────────────────────────────────────┤                  │
      │──[new steps]        │                    │                 │
      │──[re-execute]       │                    │                 │
      │──[done again]──────▶│                   │                 │
      │                    │──[re-score]─────────▶│               │
      │                    │                    │──[proceed]      │
      │                    │                    │────────────────▶│
```
