"""Demo script to test the multi-agent system without user interaction."""
import orchid; orchid.init()
from langchain_core.messages import HumanMessage
from config import setup_api_keys
from graph import create_research_graph
from state import AgentState

def demo_test():
    """Run a demo test of the system with Orchid capture mode."""
    print("🧪 Running demo test with Orchid capture mode...")
    setup_api_keys()
    research_graph = create_research_graph()
    
    test_cases = [
        {
            "query": "AI is improving at a rapid pace. Extrapolate out five years into the future and answer this question - will AI be beneficial or detrimental to humanity? Justify your opinion either way.",
            "description": "Complex ambiguous query"
        }
    ]
    
    for i, test in enumerate(test_cases, 1):
        print(f"\n{'='*50}")
        print(f"Test {i}: {test['description']}")
        print(f"Query: {test['query']}")
        print(f"{'='*50}")
        
        state: AgentState = {
            "messages": [HumanMessage(content=test['query'])],
            "parsed_query": {},
            "clarification": None,
            "research_plan": None,
            "step_results": [],
            "scratchpad": [],
            "retry_counts": {},
            "augmentation_passes": 0,
            "optimist_argument": None,
            "skeptic_argument": None,
            "final_answer": None,
            "answer_confidence": None
        }
        
        try:
            while True:
                # We can't interactively clarify in demo, so we simulate an answer if asked
                for chunk in research_graph.stream(state, stream_mode="updates"):
                    for node_name, state_update in chunk.items():
                        print(f"   [Node: {node_name}] Executed.")
                        for k, v in state_update.items():
                            if k == "messages":
                                state[k] = state.get(k, []) + v
                            else:
                                state[k] = v

                clarification = state.get("clarification")
                if clarification and clarification.get("awaiting_response") and not clarification.get("user_answer"):
                    print(f"\n❓ Clarification needed: {clarification['question']}")
                    simulated_ans = "Assume I am driving from Dallas to Austin at 8pm tonight."
                    print(f"   [Simulated Answer]: {simulated_ans}")
                    clarification["user_answer"] = simulated_ans
                    clarification["awaiting_response"] = False
                    state["clarification"] = clarification
                    continue
                
                break

            parsed = state.get("parsed_query", {})
            print(f"\n📊 Intent detected - Topics: {parsed.get('topics')}")
            print(f"📍 Location resolved: {parsed.get('location')}")
            
            if state.get("final_answer"):
                print(f"\n🎯 Final Response (Conf: {state.get('answer_confidence')}):\n{state['final_answer']}")
            else:
                print("\n❌ No response generated")
                
        except Exception as e:
            print(f"\n❌ Error in test {i}: {str(e)}")
            import traceback
            traceback.print_exc()
    
    print(f"\n{'='*50}")
    print("✅ Demo complete!")

if __name__ == "__main__":
    demo_test()
