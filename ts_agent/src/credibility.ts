import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { CredibilityAnnotationSchema, StepResult } from "./schemas.js";
import { AgentState } from "./state.js";
import { geminiFlash } from "./llm.js";
import { invokeStructured } from "./utils.js";

export const CredibilityListSchema = z.object({
  annotations: z.array(CredibilityAnnotationSchema),
});

export type CredibilityList = z.infer<typeof CredibilityListSchema>;

const scorer = geminiFlash.withStructuredOutput(CredibilityListSchema, {
  name: "CredibilityList",
});

export const CREDIBILITY_SYSTEM_PROMPT = `
You are a research credibility scorer. Evaluate the provided search result.

For each distinct source found in the result, generate a CredibilityAnnotation.
Rules:
1. Trust score (0.0-1.0): 
   - 0.9+: Official sources (NWS, NOAA, Reuters, AP)
   - 0.7+: Major local news (statesman.com, KXAN)
   - 0.4-0.6: Aggregators (weather.com, Yahoo)
   - <0.4: Social media, unknown blogs
2. Recency score (0.0-1.0):
   - 1.0: "hours ago", "today", live data
   - 0.8: "yesterday"
   - 0.5: "last week"
   - 0.2: older or undated
3. Relevance score (0.0-1.0): How directly does this source address the query?
4. Contradictions: If this source contradicts claims made in prior step_ids, list those step_ids.

Format: You MUST call the "CredibilityList" function exactly as defined. Do NOT prepend namespaces (e.g. "default_api.") and do NOT wrap the function call in code execution or Python syntax (e.g. print()).

Analyze carefully.
`;

export async function credibilityNode(state: AgentState): Promise<Partial<AgentState>> {
  const stepResults = state.step_results || [];
  if (stepResults.length === 0) {
    return {};
  }

  console.log(`\n   -> [credibility] Scoring ${stepResults.length} search results for source authority/recency...`);
  const priorSummaries: string[] = [];
  const updatedResults: StepResult[] = [];

  for (let i = 0; i < stepResults.length; i++) {
    const result = stepResults[i];
    console.log(`      - Scoring result ${i + 1}/${stepResults.length} from ${result.tool}...`);

    const context = `Original query: ${state.messages[0].content}
Current step: ${result.step_id} (Tool: ${result.tool})
Prior findings:
${priorSummaries.join("\n")}

Result to score:
${result.raw_data}`;

    const scored = await invokeStructured(
      scorer,
      [
        new SystemMessage({ content: CREDIBILITY_SYSTEM_PROMPT }),
        new HumanMessage({ content: context }),
      ],
      CredibilityListSchema
    );

    const updatedResult: StepResult = {
      ...result,
      credibility: scored.annotations.map((ann) => ({
        ...ann,
        contradicts_step_ids: ann.contradicts_step_ids || [],
      })),
    };
    updatedResults.push(updatedResult);

    const sourcesStr = scored.annotations.map((a) => a.source).join(", ");
    priorSummaries.push(`[${result.step_id}] Sources: ${sourcesStr}`);
    console.log(`        Done (${scored.annotations.length} sources identified).`);
  }

  return {
    step_results: updatedResults,
  };
}

export function buildCredibilityReport(stepResults: StepResult[]): string {
  const report: string[] = [];
  for (const r of stepResults) {
    report.push(`[${r.step_id}] Tool: ${r.tool}`);
    if (!r.credibility || r.credibility.length === 0) {
      report.push("  No credibility scores generated.");
      continue;
    }

    for (const ann of r.credibility) {
      const avg = (ann.trust_score + ann.recency_score + ann.relevance_score) / 3;
      const contradictStr = ann.contradicts_step_ids && ann.contradicts_step_ids.length > 0
        ? ` | CONTRADICTS: ${JSON.stringify(ann.contradicts_step_ids)}`
        : "";
      report.push(
        `  - ${ann.source}: Trust ${ann.trust_score.toFixed(1)}, ` +
        `Rec ${ann.recency_score.toFixed(1)}, Rel ${ann.relevance_score.toFixed(1)} ` +
        `-> Avg ${avg.toFixed(2)}${contradictStr}`
      );
      if (ann.notes) {
        report.push(`    Notes: ${ann.notes}`);
      }
    }
  }

  return report.join("\n");
}
