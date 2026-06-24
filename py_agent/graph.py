"""Main graph orchestration for the multi-agent system."""
from langgraph.graph import StateGraph, END, START
from .state import AgentState
from .agents import (
    intent_parser_node, 
    generate_clarification_node,
    executor_node,
    signal_handler_node,
    evidence_evaluator_node
)
from .planner import planner_node
from .credibility import credibility_node
from .debate import optimist_node, skeptic_node, judge_node

def route_after_intent(state: AgentState) -> str:
    parsed = state.get("parsed_query", {})
    if parsed.get("is_ambiguous"):
        clarification = state.get("clarification")
        # If no clarification generated yet, or waiting for answer
        if not clarification or not clarification.get("user_answer"):
            return "clarification"
    return "planner"

def route_after_executor(state: AgentState) -> str:
    plan = state.get("research_plan", {})
    if plan.get("current_step_idx", 0) < len(plan.get("steps", [])):
        scratchpad = state.get("scratchpad", [])
        unacted = [s for s in scratchpad if not s.get("acted_on") and s.get("signal_type") == "amend_plan"]
        if unacted:
            return "signal_handler"
        return "executor"
    return "evidence_evaluator"

def route_after_evidence(state: AgentState) -> str:
    plan = state.get("research_plan", {})
    if plan.get("current_step_idx", 0) < len(plan.get("steps", [])):
        return "executor"
    return "credibility"

def create_research_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("intent_parser", intent_parser_node)
    workflow.add_node("clarification", generate_clarification_node)
    workflow.add_node("planner", planner_node)
    workflow.add_node("executor", executor_node)
    workflow.add_node("signal_handler", signal_handler_node)
    workflow.add_node("evidence_evaluator", evidence_evaluator_node)
    workflow.add_node("credibility", credibility_node)
    workflow.add_node("optimist", optimist_node)
    workflow.add_node("skeptic", skeptic_node)
    workflow.add_node("judge", judge_node)
    
    workflow.add_edge(START, "intent_parser")
    
    workflow.add_conditional_edges(
        "intent_parser",
        route_after_intent,
        {
            "clarification": "clarification",
            "planner": "planner"
        }
    )
    
    # We pause execution for clarification in main.py, but graph logic goes END
    workflow.add_edge("clarification", END)
    
    workflow.add_edge("planner", "executor")
    
    workflow.add_conditional_edges(
        "executor",
        route_after_executor,
        {
            "executor": "executor",
            "signal_handler": "signal_handler",
            "evidence_evaluator": "evidence_evaluator"
        }
    )
    
    workflow.add_edge("signal_handler", "executor")
    
    workflow.add_conditional_edges(
        "evidence_evaluator",
        route_after_evidence,
        {
            "executor": "executor",
            "credibility": "credibility"
        }
    )
    
    workflow.add_edge("credibility", "optimist")
    workflow.add_edge("optimist", "skeptic")
    workflow.add_edge("skeptic", "judge")
    workflow.add_edge("judge", END)
    
    return workflow.compile()
