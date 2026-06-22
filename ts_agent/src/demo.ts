import dotenv from "dotenv";
import * as orchid from "orchid-sdk";

dotenv.config();
await orchid.init();

import { HumanMessage } from "@langchain/core/messages";
import { createResearchGraph } from "./graph.js";
import { AgentState } from "./state.js";

async function demoTest() {
  console.log("🧪 Running demo test...");
  const researchGraph = createResearchGraph();

  const testCases = [
    {
      query: "Is it the right time for my company to transition our codebase to AI-generated code, or should we wait?",
      description: "Complex ambiguous query",
    },
  ];

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Test ${i + 1}: ${test.description}`);
    console.log(`Query: ${test.query}`);
    console.log(`${"=".repeat(50)}`);

    const state: AgentState = {
      messages: [new HumanMessage({ content: test.query })],
      parsed_query: {},
      clarification: null,
      research_plan: null,
      step_results: [],
      scratchpad: [],
      retry_counts: {},
      augmentation_passes: 0,
      optimist_argument: null,
      skeptic_argument: null,
      final_answer: null,
      answer_confidence: null,
    };

    try {
      while (true) {
        // Critical Defect #6 Fix: properly iterating over state updates stream via Object.entries(chunk)
        const stream = await researchGraph.stream(state, { streamMode: "updates" });
        for await (const chunk of stream) {
          for (const [nodeName, stateUpdate] of Object.entries(chunk)) {
            console.log(`   [Node: ${nodeName}] Executed.`);
            const update = stateUpdate as Record<string, any>;
            for (const [k, v] of Object.entries(update)) {
              if (k === "messages") {
                state.messages = [...(state.messages || []), ...(v as any[])];
              } else {
                (state as any)[k] = v;
              }
            }
          }
        }

        const clarification = state.clarification;
        if (clarification && clarification.awaiting_response && !clarification.user_answer) {
          console.log(`\n❓ Clarification needed: ${clarification.question}`);
          const simulatedAns = "We are a 10-person startup writing a TypeScript and React web app, looking to use autonomous agent tools to help build new features.";
          console.log(`   [Simulated Answer]: ${simulatedAns}`);
          clarification.user_answer = simulatedAns;
          clarification.awaiting_response = false;
          state.clarification = clarification;
          continue;
        }

        break;
      }

      const parsed = state.parsed_query;
      console.log(`\n📊 Intent detected - Topics: ${JSON.stringify(parsed.topics)}`);
      console.log(`📍 Location resolved: ${parsed.location}`);

      if (state.final_answer) {
        console.log(`\n🎯 Final Response (Conf: ${state.answer_confidence}):\n${state.final_answer}`);
      } else {
        console.log("\n❌ No response generated");
      }
    } catch (e: any) {
      console.error(`\n❌ Error in test ${i + 1}: ${e.message || String(e)}`);
      console.error(e.stack || e);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("✅ Demo complete!");
}

demoTest().catch((err) => {
  console.error("Unhandle rejection in demo runner:", err);
});
