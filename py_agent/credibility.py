"""Credibility Scoring."""
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel
from typing import List
from schemas import CredibilityAnnotation, StepResult
from state import AgentState
from llm import gemini_flash
from utils import invoke_structured

class CredibilityList(BaseModel):
    annotations: List[CredibilityAnnotation]

_scorer = gemini_flash.with_structured_output(CredibilityList)

CREDIBILITY_SYSTEM_PROMPT = """
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
"""

def credibility_node(state: AgentState) -> AgentState:
    step_results = state.get("step_results", [])
    if not step_results:
        return state

    print(f"\n   -> [credibility] Scoring {len(step_results)} search results for source authority/recency...")
    prior_summaries = []
    updated_results = []
    
    for i, r_dict in enumerate(step_results, 1):
        result = StepResult(**r_dict)
        
        print(f"      - Scoring result {i}/{len(step_results)} from {result.tool}...", end="", flush=True)
        
        context = (
            f"Original query: {state['messages'][0].content}\n"
            f"Current step: {result.step_id} (Tool: {result.tool})\n"
            f"Prior findings:\n" + "\n".join(prior_summaries) + "\n\n"
            f"Result to score:\n{result.raw_data}"
        )
        
        scored: CredibilityList = invoke_structured(
            _scorer,
            [
                SystemMessage(content=CREDIBILITY_SYSTEM_PROMPT),
                HumanMessage(content=context)
            ],
            CredibilityList
        )
        
        result.credibility = scored.annotations
        updated_results.append(result.model_dump())
        
        # Build summary for next iteration's contradiction check
        sources_str = ", ".join([a.source for a in scored.annotations])
        prior_summaries.append(f"[{result.step_id}] Sources: {sources_str}")
        print(f" Done ({len(scored.annotations)} sources identified).")

    return {
        **state,
        "step_results": updated_results
    }

def build_credibility_report(step_results: list) -> str:
    report = []
    for r_dict in step_results:
        r = StepResult(**r_dict)
        report.append(f"[{r.step_id}] Tool: {r.tool}")
        if not r.credibility:
            report.append("  No credibility scores generated.")
            continue
            
        for ann in r.credibility:
            avg = (ann.authority_score + ann.recency_score + ann.relevance_score) / 3
            contradict_str = f" | CONTRADICTS: {ann.contradicts_step_ids}" if ann.contradicts_step_ids else ""
            report.append(
                f"  - {ann.source}: Auth {ann.authority_score:.1f}, "
                f"Rec {ann.recency_score:.1f}, Rel {ann.relevance_score:.1f} "
                f"-> Avg {avg:.2f}{contradict_str}"
            )
            if ann.notes:
                report.append(f"    Notes: {ann.notes}")
    
    return "\n".join(report)
