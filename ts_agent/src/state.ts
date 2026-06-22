import { BaseMessage } from "@langchain/core/messages";
import { ClarificationState, ResearchPlan, StepResult, AgentSignal } from "./schemas.js";

// Message reducer function that handles single messages, arrays, and standardizes appending.
export function reduceMessages(
  left: BaseMessage[],
  right: BaseMessage | BaseMessage[]
): BaseMessage[] {
  const rightArr = Array.isArray(right) ? right : [right];
  // Filter out duplicates based on id if available, otherwise append
  const merged = [...left];
  for (const msg of rightArr) {
    const existingIndex = merged.findIndex((m) => m.id === msg.id && msg.id !== undefined);
    if (existingIndex !== -1) {
      merged[existingIndex] = msg;
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

export interface AgentState {
  messages: BaseMessage[];
  parsed_query: Record<string, any>;
  clarification: ClarificationState | null;
  research_plan: ResearchPlan | null;
  step_results: StepResult[];
  scratchpad: AgentSignal[];
  retry_counts: Record<string, number>;
  augmentation_passes: number;
  optimist_argument: string | null;
  skeptic_argument: string | null;
  final_answer: string | null;
  answer_confidence: number | null;
}

export const AgentStateAnnotation = {
  messages: {
    reducer: reduceMessages,
    default: () => [],
  },
  parsed_query: {
    reducer: (left: Record<string, any>, right: Record<string, any>) => ({ ...left, ...right }),
    default: () => ({}),
  },
  clarification: {
    reducer: (left: ClarificationState | null, right: ClarificationState | null) => right,
    default: () => null,
  },
  research_plan: {
    reducer: (left: ResearchPlan | null, right: ResearchPlan | null) => right,
    default: () => null,
  },
  step_results: {
    reducer: (left: StepResult[], right: StepResult[]) => right,
    default: () => [],
  },
  scratchpad: {
    reducer: (left: AgentSignal[], right: AgentSignal[]) => right,
    default: () => [],
  },
  retry_counts: {
    reducer: (left: Record<string, number>, right: Record<string, number>) => ({ ...left, ...right }),
    default: () => ({}),
  },
  augmentation_passes: {
    reducer: (left: number, right: number) => right,
    default: () => 0,
  },
  optimist_argument: {
    reducer: (left: string | null, right: string | null) => right,
    default: () => null,
  },
  skeptic_argument: {
    reducer: (left: string | null, right: string | null) => right,
    default: () => null,
  },
  final_answer: {
    reducer: (left: string | null, right: string | null) => right,
    default: () => null,
  },
  answer_confidence: {
    reducer: (left: number | null, right: number | null) => right,
    default: () => null,
  },
};
