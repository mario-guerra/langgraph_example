"""Demo script to test the multi-agent system without user interaction."""
from langchain_core.messages import HumanMessage
from config import setup_api_keys
from graph import create_research_graph
from state import AgentState

def demo_test():
    """Run a demo test of the system."""
    print("🧪 Running demo test...")
    
    # Setup
    setup_api_keys()
    research_graph = create_research_graph()
    
    # Test cases
    test_cases = [
        {
            "location": "San Francisco, CA",
            "query": "weather",
            "description": "Weather-only query"
        },
        {
            "location": "New York, NY", 
            "query": "news",
            "description": "News-only query"
        },
        {
            "location": "London, UK",
            "query": "weather and news", 
            "description": "Combined query"
        }
    ]
    
    for i, test in enumerate(test_cases, 1):
        print(f"\n{'='*50}")
        print(f"Test {i}: {test['description']}")
        print(f"Location: {test['location']}")
        print(f"Query: {test['query']}")
        print(f"{'='*50}")
        
        # Create initial state
        initial_state: AgentState = {
            "messages": [HumanMessage(content=test['query'])],
            "location": test['location'],
            "intent": "unknown",
            "weather_data": "",
            "news_data": ""
        }
        
        try:
            # Execute the graph
            result = research_graph.invoke(initial_state)
            
            # Display results
            print(f"\n📊 Intent detected: {result['intent']}")
            print(f"📍 Location resolved: {result['location']}")
            
            if result["messages"]:
                final_response = result["messages"][-1].content
                print(f"\n🎯 Final Response:\n{final_response}")
            else:
                print("\n❌ No response generated")
                
        except Exception as e:
            print(f"\n❌ Error in test {i}: {str(e)}")
    
    print(f"\n{'='*50}")
    print("✅ Demo complete!")

if __name__ == "__main__":
    demo_test()
