"""Debate and Judge nodes."""
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from schemas import DebateArgument, JudgeVerdict, StepResult
from state import AgentState
from llm import o3_mini, claude_sonnet
from utils import invoke_structured
from credibility import build_credibility_report

_optimist = o3_mini.with_structured_output(DebateArgument)
_skeptic = claude_sonnet.with_structured_output(DebateArgument)
_judge = claude_sonnet.with_structured_output(JudgeVerdict)

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

def format_evidence_for_debate(step_results: list) -> str:
    """Format step results for debate agent consumption."""
    sections = []
    for r_dict in step_results:
        result = StepResult(**r_dict)
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

def optimist_node(state: AgentState) -> AgentState:
    print("\n   -> [optimist] Drafting the best-case argument from the evidence...")
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
            SystemMessage(content=OPTIMIST_SYSTEM_PROMPT),
            HumanMessage(content=context)
        ],
        DebateArgument
    )

    return {
        **state,
        "optimist_argument": argument.model_dump_json()
    }

def skeptic_node(state: AgentState) -> AgentState:
    print("\n   -> [skeptic] Challenging the Optimist's argument for weaknesses...")
    step_results = state.get("step_results", [])
    credibility_report = build_credibility_report(step_results)
    evidence_text = format_evidence_for_debate(step_results)

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
            SystemMessage(content=SKEPTIC_SYSTEM_PROMPT),
            HumanMessage(content=context)
        ],
        DebateArgument
    )

    return {
        **state,
        "skeptic_argument": argument.model_dump_json()
    }

def judge_node(state: AgentState) -> AgentState:
    print("\n   -> [judge] Weighing the debate and synthesizing final calibrated answer...")
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
            SystemMessage(content=JUDGE_SYSTEM_PROMPT),
            HumanMessage(content=context)
        ],
        JudgeVerdict
    )

    return {
        **state,
        "final_answer": verdict.answer,
        "answer_confidence": verdict.confidence,
        "messages": state["messages"] + [AIMessage(content=verdict.answer)]
    }
