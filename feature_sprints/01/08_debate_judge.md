# Spec 08: Adversarial Debate + Judge Synthesis (Diamond 2)

## Problem

The current summary_agent does this:

```python
# agents.py — CURRENT (line 144–148)
if intent == "both":
    response = model.invoke([HumanMessage(content=formatted_prompt)])
    final_content = response.content
else:
    final_content = formatted_prompt  # Not even an LLM call for single-topic!
```

For single-topic queries, the LLM isn't even used for synthesis. For multi-topic, it gets one shot with no adversarial check. This produces overconfident answers with no calibration.

The fix: two adversarial agents argue their best interpretation of the evidence, then a judge synthesizes a calibrated answer. This is a real technique (AI debate for alignment) and produces measurably better-calibrated outputs on uncertain evidence.

---

## Architecture

Three LLM calls in sequence:
1. **Optimist** — argues the most favorable interpretation of the evidence
2. **Skeptic** — attacks Optimist's interpretation, finds weaknesses, raises contradictions
3. **Judge** — weighs both arguments, produces the final calibrated answer

All three receive: the original query, all step results with credibility scores, the evidence evaluator's gap report (from scratchpad), and each other's arguments (sequentially).

**File:** `debate.py` (new file)

---

## Component: Optimist Agent

```python
from schemas import DebateArgument, JudgeVerdict, StepResult
from state import AgentState

_optimist = model.with_structured_output(DebateArgument)

OPTIMIST_SYSTEM_PROMPT = """
You are the Optimist in a research debate. Your role is to argue the most
well-supported, complete interpretation of the evidence collected.

Rules:
- Cite specific step_ids as evidence for every claim
- Acknowledge limitations, but emphasize what IS known
- Do not fabricate data not present in the evidence
- Focus on what gives the user actionable confidence

Your argument will be reviewed by a Skeptic. Be precise so the Skeptic
can engage with specific claims rather than generalities.
"""

def optimist_node(state: AgentState) -> AgentState:
    step_results = state.get("step_results", [])
    credibility_report = build_credibility_report(step_results)
    evidence_text = format_evidence_for_debate(step_results)
    gap_signals = [
        s["payload"] for s in state.get("scratchpad", [])
        if s.get("signal_type") == "flag_finding"
    ]

    context = (
        f"User query: {state['messages'][0].content}\n\n"
        f"Evidence:\n{evidence_text}\n\n"
        f"Credibility scores:\n{credibility_report}\n\n"
        f"Known gaps/caveats:\n" + ("\n".join(gap_signals) or "None identified")
    )

    argument: DebateArgument = invoke_structured(
        _optimist,
        [
            {"role": "system", "content": OPTIMIST_SYSTEM_PROMPT},
            {"role": "user",   "content": context}
        ],
        DebateArgument
    )

    return {
        **state,
        "optimist_argument": argument.model_dump_json()
    }
```

---

## Component: Skeptic Agent

```python
_skeptic = model.with_structured_output(DebateArgument)

SKEPTIC_SYSTEM_PROMPT = """
You are the Skeptic in a research debate. The Optimist has made an argument.
Your role is to rigorously challenge it.

Your attack vectors:
1. Credibility attacks: Point to low-authority or stale sources cited as evidence
2. Contradiction attacks: Identify claims that are contradicted by other results
3. Gap attacks: Identify what is NOT known that undermines the Optimist's confidence
4. Relevance attacks: Challenge whether cited evidence actually supports the claim

Rules:
- Reference specific step_ids when challenging evidence
- Be rigorous, not pedantic — only raise substantive issues
- Your goal is calibration, not demolition. Acknowledge what IS solid.
- Your argument will be read by a Judge who values precision.
"""

def skeptic_node(state: AgentState) -> AgentState:
    step_results = state.get("step_results", [])
    credibility_report = build_credibility_report(step_results)
    evidence_text = format_evidence_for_debate(step_results)

    # Retrieve Optimist's argument from state
    optimist_arg_text = state.get("optimist_argument", "No argument provided.")

    context = (
        f"User query: {state['messages'][0].content}\n\n"
        f"Evidence:\n{evidence_text}\n\n"
        f"Credibility scores:\n{credibility_report}\n\n"
        f"Optimist's argument:\n{optimist_arg_text}"
    )

    argument: DebateArgument = invoke_structured(
        _skeptic,
        [
            {"role": "system", "content": SKEPTIC_SYSTEM_PROMPT},
            {"role": "user",   "content": context}
        ],
        DebateArgument
    )

    return {
        **state,
        "skeptic_argument": argument.model_dump_json()
    }
```

---

## Component: Judge Agent

```python
_judge = model.with_structured_output(JudgeVerdict)

JUDGE_SYSTEM_PROMPT = """
You are the Judge in a research debate. You have read:
- The collected evidence with credibility scores
- The Optimist's argument (most favorable interpretation)
- The Skeptic's challenges and counterpoints

Your job is to produce a calibrated, honest final answer.

Rules:
1. Weight evidence by credibility scores — high-authority, recent sources take precedence
2. Acknowledge what the Skeptic correctly identified as uncertain
3. Flag specific claims in your answer that the user should treat with caution
4. Be direct — the user wants an answer, not a dissertation
5. If contradictions between sources remain unresolved, say so explicitly
6. Your confidence score must reflect the actual quality of the evidence, not
   your desire to sound definitive

Format: The answer field should be readable by a non-expert. Use markdown.
"""

def judge_node(state: AgentState) -> AgentState:
    step_results = state.get("step_results", [])
    credibility_report = build_credibility_report(step_results)
    evidence_text = format_evidence_for_debate(step_results)

    optimist_arg = state.get("optimist_argument", "")
    skeptic_arg = state.get("skeptic_argument", "")

    context = (
        f"User query: {state['messages'][0].content}\n\n"
        f"Evidence:\n{evidence_text}\n\n"
        f"Credibility scores:\n{credibility_report}\n\n"
        f"Optimist's argument:\n{optimist_arg}\n\n"
        f"Skeptic's argument:\n{skeptic_arg}"
    )

    verdict: JudgeVerdict = invoke_structured(
        _judge,
        [
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user",   "content": context}
        ],
        JudgeVerdict
    )

    return {
        **state,
        "final_answer": verdict.answer,
        "answer_confidence": verdict.confidence,
        "messages": [AIMessage(content=verdict.answer)]
    }
```

---

## Helper: Evidence Formatter

```python
def format_evidence_for_debate(step_results: list) -> str:
    """Format step results for debate agent consumption."""
    sections = []
    for r in step_results:
        result = StepResult(**r)
        cred = result.credibility[0] if result.credibility else None
        cred_note = ""
        if cred:
            avg = (cred.authority_score + cred.recency_score + cred.relevance_score) / 3
            cred_note = f" [credibility: {avg:.2f}, source: {cred.source}]"

        sections.append(
            f"[{result.step_id}]{cred_note}\n"
            f"Quality: {result.evidence_quality.value} | Confidence: {result.confidence:.2f}\n"
            f"{result.raw_data[:500]}"
        )
    return "\n\n---\n\n".join(sections)
```

---

## CLI Output Format

After judge completes, `main.py` displays:

```
════════════════════════════════════════════
📋 RESEARCH COMPLETE
════════════════════════════════════════════

[final_answer markdown rendered here]

────────────────────────────────────────────
Confidence: 0.78 | Debate: Skeptic raised valid concerns
⚠️  Uncertainty flags:
  • Storm timeline is based on a single source (weather.com)
  • Concert cancellation status unconfirmed

💡 Recommended follow-up: Check venue's official social media for cancellation notices.
════════════════════════════════════════════
```

---

## Graph Edges (Debate Stage)

```python
workflow.add_edge("evidence_evaluator", "debate_optimist")  # when proceeding
workflow.add_edge("debate_optimist",    "debate_skeptic")
workflow.add_edge("debate_skeptic",     "debate_judge")
workflow.add_edge("debate_judge",       END)
```

---

## Sequence Diagram

```
Optimist           Skeptic            Judge            State
   │                  │                 │                │
   │──[read evidence]─────────────────────────────────── │
   │──[LLM call]       │                 │               │
   │──[DebateArgument] │                 │               │
   │──[save to state]─────────────────────────────────── │
   │                  │                 │               │
   │                  │──[read evidence + optimist arg]  │
   │                  │──[LLM call]     │               │
   │                  │──[DebateArgument]               │
   │                  │──[save to state]──────────────── │
   │                  │                 │               │
   │                  │                 │──[read all]   │
   │                  │                 │──[LLM call]   │
   │                  │                 │──[JudgeVerdict]
   │                  │                 │──[final_answer ─▶ state]
   │                  │                 │──[END]        │
```
