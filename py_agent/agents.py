"""Agent implementations for the multi-agent system."""
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from .schemas import (
    IntentSchema, ClarificationSchema, ClarificationState,
    ResearchPlan, PlanStep, StepResult, EvidenceQuality,
    UncertaintyDecision, UncertaintyAction, EvidenceSufficiencyDecision
)
from .state import AgentState
from .llm import gemini_flash, claude_sonnet
from .utils import invoke_structured
from .tools import weather_search, news_search, web_search
from .credibility import build_credibility_report

_intent_parser = gemini_flash.with_structured_output(IntentSchema)
_clarification_generator = gemini_flash.with_structured_output(ClarificationSchema)
_step_evaluator = gemini_flash.with_structured_output(UncertaintyDecision)
_evidence_evaluator = claude_sonnet.with_structured_output(EvidenceSufficiencyDecision)

TOOL_REGISTRY = {
    "weather_search": weather_search,
    "news_search":    news_search,
    "web_search":     web_search,
}

INTENT_SYSTEM_PROMPT = """
You are an intent extraction engine for a research assistant.

Given a user query, extract:
1. location — the geographic location the user is asking about. Fully resolve abbreviations
   (NYC -> New York, NY). Empty string if no location is mentioned.
2. topics — a list of research topics. Do not limit to weather/news. Use your judgment:
   - "Should I go to the concert?" -> ["weather", "local_events"]
   - "Is it safe to drive?" -> ["weather", "traffic", "road_conditions"]
   - "What's the situation?" -> flag as ambiguous
3. time_range — temporal scope: "now", "today", "tonight", "this_week", "unspecified"
4. is_ambiguous — True only when multiple distinct interpretations would lead to
   meaningfully different research plans. "What's the weather?" is NOT ambiguous even
   without a location (location is simply missing, which is handled separately).
5. ambiguity_reason — required when is_ambiguous=True. One sentence.

Be conservative with is_ambiguous=True. Only flag genuine semantic ambiguity,
not missing information.
"""

def intent_parser_node(state: AgentState) -> AgentState:
    """Intent parser node."""
    messages = state["messages"]
    user_message = messages[-1].content if messages else ""

    # If we have a clarification answer, append it to context
    clarification = state.get("clarification")
    if clarification and not clarification.get("awaiting_response") and clarification.get("user_answer"):
        user_message = (
            f"Original query: {messages[0].content}\n"
            f"Clarification: {clarification.get('user_answer')}"
        )

    result: IntentSchema = invoke_structured(
        _intent_parser,
        [
            SystemMessage(content=INTENT_SYSTEM_PROMPT),
            HumanMessage(content=str(user_message))
        ],
        IntentSchema
    )

    return {
        **state,
        "parsed_query": result.model_dump(),
        "clarification": None  # Reset — will be re-set if still ambiguous
    }


CLARIFICATION_SYSTEM_PROMPT = """
You are a clarification agent. The user's query is ambiguous in a specific way.
Generate exactly ONE targeted question that, when answered, fully resolves the ambiguity.
Do not ask multiple questions. Do not ask for information you can infer.
The question must be answerable in one or two sentences.
"""

def generate_clarification_node(state: AgentState) -> AgentState:
    """Clarification node — only reached when is_ambiguous=True."""
    parsed = state["parsed_query"]
    user_message = state["messages"][0].content

    result: ClarificationSchema = invoke_structured(
        _clarification_generator,
        [
            SystemMessage(content=CLARIFICATION_SYSTEM_PROMPT),
            HumanMessage(content=(
                f"User query: {user_message}\n"
                f"Detected ambiguity: {parsed.get('ambiguity_reason')}"
            ))
        ],
        ClarificationSchema
    )

    clarification = ClarificationState(
        question=result.question,
        awaiting_response=True,
        user_answer=None
    )

    return {**state, "clarification": clarification.model_dump()}


STEP_EVALUATOR_PROMPT = """
You are a research quality evaluator.

Given:
- The user's original query
- The research step that was just executed (tool, query, rationale)  
- The raw result returned by the tool

Evaluate the result and decide:
- accept: The result adequately addresses this step's rationale. Confidence >= 0.6.
- retry: The result is incomplete, off-topic, or low quality. Provide an amended_query.
- escalate: The result reveals we need more information from the user to proceed.

Be honest about result quality. Do not accept thin or irrelevant results.
"""

def executor_node(state: AgentState) -> AgentState:
    """Execute the current plan step and evaluate the result."""
    plan_dict = state.get("research_plan")
    if not plan_dict:
        return state
    
    plan = ResearchPlan(**plan_dict)
    current_step = plan.current_step()

    if current_step is None:
        return state  # Plan complete

    print(f"\n   -> [executor] Executing step: {current_step.tool}('{current_step.query}')...", end="", flush=True)

    # Invoke the tool
    tool_fn = TOOL_REGISTRY.get(current_step.tool)
    if not tool_fn:
        raw_data = f"Unknown tool: {current_step.tool}"
    else:
        try:
            raw_data = tool_fn.invoke({
                "query": current_step.query,
                "location": current_step.location
            })
        except Exception as e:
            raw_data = f"Error executing tool: {str(e)}"

    print(" Done.")
    print("      - Evaluating result quality...", end="", flush=True)

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
            SystemMessage(content=STEP_EVALUATOR_PROMPT),
            HumanMessage(content=eval_context)
        ],
        UncertaintyDecision
    )

    print(f" Decision: {decision.action.value.upper()}")

    retry_counts = state.get("retry_counts", {})
    retry_count = retry_counts.get(current_step.step_id, 0)

    if decision.action == UncertaintyAction.retry and retry_count < 2:
        plan.steps[plan.current_step_idx].query = decision.amended_query
        new_retry_counts = {**retry_counts, current_step.step_id: retry_count + 1}

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


def signal_handler_node(state: AgentState) -> AgentState:
    """Handle cross-agent signals (currently just amends plan based on amend_plan signals)."""
    scratchpad = state.get("scratchpad", [])
    unacted_signals = [s for s in scratchpad if not s.get("acted_on") and s.get("signal_type") == "amend_plan"]
    
    if not unacted_signals:
        return state
        
    plan = ResearchPlan(**state["research_plan"])
    
    # Process only the first unacted signal to prevent uncontrolled growth
    sig = unacted_signals[0]
    
    if len(plan.steps) < 6:
        # Example naive processing: just add a web search
        # In a full implementation, you'd parse the payload or ask the LLM to generate the step
        new_step = PlanStep(
            step_id=f"step_amended_{len(plan.steps)+1}",
            tool="web_search",
            query=sig.get("payload", ""),
            location="",
            rationale="Added via signal"
        )
        plan.append_step(new_step)
        
    # Mark signal as acted on
    updated_scratchpad = []
    for s in scratchpad:
        if s == sig:
            s_copy = dict(s)
            s_copy["acted_on"] = True
            updated_scratchpad.append(s_copy)
        else:
            updated_scratchpad.append(s)

    return {
        **state,
        "research_plan": plan.model_dump(),
        "scratchpad": updated_scratchpad,
    }


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
4. Is the overall confidence of the evidence set adequate (average >= 0.5)?

Decision options:
- proceed: Evidence is sufficient. Go to synthesis.
- augment: A specific gap exists that warrants 1-2 additional searches.
            Provide the augmentation_steps (max 2 new steps).
- proceed_with_caveats: Evidence is thin but additional searches are unlikely to help.
                        Note the gaps explicitly — the judge will flag them.
"""

def evidence_evaluator_node(state: AgentState) -> AgentState:
    """Outer uncertainty evaluation after all plan steps complete."""
    print("\n   -> [evidence_evaluator] Auditing collected evidence for gaps or contradictions...", end="", flush=True)
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
            SystemMessage(content=EVIDENCE_EVALUATOR_PROMPT),
            HumanMessage(content=context)
        ],
        EvidenceSufficiencyDecision
    )

    print(f" Decision: {decision.decision.upper()}")

    if decision.decision == "augment":
        # Prevent infinite augmentation loops
        if state.get("augmentation_passes", 0) >= 1:
            decision.decision = "proceed_with_caveats"
        else:
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
                "scratchpad": state.get("scratchpad", []) + [{
                    "from_agent": "evidence_evaluator",
                    "to_agent": "any",
                    "signal_type": "flag_finding",
                    "payload": f"Coverage gaps: {decision.coverage_gaps}. "
                               f"Contradictions: {decision.contradiction_summary}",
                    "acted_on": False
                }]
            }

    # proceed or proceed_with_caveats
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
