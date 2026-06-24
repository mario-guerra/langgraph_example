"""Main application entry point."""
from langchain_core.messages import HumanMessage, AIMessage
from py_agent.config import setup_api_keys
from py_agent.graph import create_research_graph
from py_agent.state import AgentState
from py_agent.schemas import ClarificationState
import sys

def main():
    print("🔧 Setting up API keys...")
    setup_api_keys()
    
    print("🏗️ Building multi-agent research graph...")
    research_graph = create_research_graph()
    
    print("✅ Ready! Adaptive Multi-Agent Research System.")
    print("-" * 50)
    
    while True:
        try:
            query = input("\nEnter your query (or 'quit' to exit): ").strip()
            if query.lower() in ['quit', 'exit', 'q']:
                print("Goodbye! 👋")
                break
            if not query:
                continue
            
            state: AgentState = {
                "messages": [HumanMessage(content=query)],
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
            
            while True:
                print("\n🧠 Thinking...")
                
                # Execute graph, yielding state updates
                for chunk in research_graph.stream(state, stream_mode=["messages", "updates"]):
                    if len(chunk) == 2:
                        mode, payload = chunk
                        if mode == "messages":
                            message, metadata = payload
                            # Only print if it's from an agent (not the human input we just added)
                            if isinstance(message, AIMessage) and message.content:
                                print(message.content, end="", flush=True)
                        elif mode == "updates":
                            for node_name, state_update in payload.items():
                                print(f"\n   [Node: {node_name}] Executed.")
                                # apply list appends manually for state
                                for k, v in state_update.items():
                                    if k == "messages":
                                        state[k] = state.get(k, []) + v
                                    else:
                                        state[k] = v

                # Check if we paused for clarification
                clarification = state.get("clarification")
                if clarification and clarification.get("awaiting_response") and not clarification.get("user_answer"):
                    print(f"\n❓ Clarification needed: {clarification['question']}")
                    user_ans = input("Your answer: ").strip()
                    
                    # Update state with answer and loop back
                    clarification["user_answer"] = user_ans
                    clarification["awaiting_response"] = False
                    state["clarification"] = clarification
                    continue
                
                # If we finished normally, break the loop
                break
                
            if state.get("final_answer"):
                print(f"\n📋 Final Answer (Confidence: {state.get('answer_confidence')}):")
                print(state["final_answer"])
            else:
                print("\n❌ No final answer generated.")
                
        except KeyboardInterrupt:
            print("\n\nGoodbye! 👋")
            break
        except Exception as e:
            print(f"\n❌ Error: {str(e)}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()
