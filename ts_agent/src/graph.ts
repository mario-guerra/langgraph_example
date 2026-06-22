import { StateGraph, END, START } from "@langchain/langgraph";
import { AgentStateAnnotation, AgentState } from "./state.js";
import {
  intentParserNode,
  generateClarificationNode,
  plannerNode,
  executorNode,
  signalHandlerNode,
  evidenceEvaluatorNode,
  optimistNode,
  skepticNode,
  judgeNode,
} from "./agents.js";
import { credibilityNode } from "./credibility.js";

export function routeAfterIntent(state: AgentState): string {
  const parsed = state.parsed_query || {};
  if (parsed.is_ambiguous) {
    const clarification = state.clarification;
    // If no clarification generated yet, or waiting for answer
    if (!clarification || !clarification.user_answer) {
      return "clarification_node";
    }
  }
  return "planner";
}

export function routeAfterExecutor(state: AgentState): string {
  const plan = state.research_plan;
  if (!plan) {
    return "evidence_evaluator";
  }
  if (plan.current_step_idx < plan.steps.length) {
    const scratchpad = state.scratchpad || [];
    const unacted = scratchpad.filter((s) => !s.acted_on && s.signal_type === "amend_plan");
    if (unacted.length > 0) {
      return "signal_handler";
    }
    return "executor";
  }
  return "evidence_evaluator";
}

export function routeAfterEvidence(state: AgentState): string {
  const plan = state.research_plan;
  if (plan && plan.current_step_idx < plan.steps.length) {
    return "executor";
  }
  return "credibility";
}

export function createResearchGraph() {
  const workflow = new StateGraph<AgentState>({
    channels: AgentStateAnnotation,
  })
    .addNode("intent_parser", intentParserNode)
    .addNode("clarification_node", generateClarificationNode)
    .addNode("planner", plannerNode)
    .addNode("executor", executorNode)
    .addNode("signal_handler", signalHandlerNode)
    .addNode("evidence_evaluator", evidenceEvaluatorNode)
    .addNode("credibility", credibilityNode)
    .addNode("optimist", optimistNode)
    .addNode("skeptic", skepticNode)
    .addNode("judge", judgeNode);

  workflow.addEdge(START, "intent_parser");

  workflow.addConditionalEdges("intent_parser", routeAfterIntent, {
    clarification_node: "clarification_node",
    planner: "planner",
  });

  workflow.addEdge("clarification_node", END);
  workflow.addEdge("planner", "executor");

  workflow.addConditionalEdges("executor", routeAfterExecutor, {
    executor: "executor",
    signal_handler: "signal_handler",
    evidence_evaluator: "evidence_evaluator",
  });

  workflow.addEdge("signal_handler", "executor");

  workflow.addConditionalEdges("evidence_evaluator", routeAfterEvidence, {
    executor: "executor",
    credibility: "credibility",
  });

  workflow.addEdge("credibility", "optimist");
  workflow.addEdge("optimist", "skeptic");
  workflow.addEdge("skeptic", "judge");
  workflow.addEdge("judge", END);

  return workflow.compile();
}
