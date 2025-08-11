"""Main application entry point."""
from langchain_core.messages import HumanMessage
from config import setup_api_keys
from graph import create_research_graph
from state import AgentState

def main():
    """Main application function."""
    print("🔧 Setting up API keys...")
    setup_api_keys()
    
    print("🏗️ Building multi-agent research graph...")
    research_graph = create_research_graph()
    
    print("✅ Ready! Multi-agent weather and news research system.")
    print("-" * 50)
    
    while True:
        try:
            # Get user input
            location = input("\nEnter your location (or 'quit' to exit): ").strip()
            if location.lower() in ['quit', 'exit', 'q']:
                print("Goodbye! 👋")
                break
                
            query = input("Enter your query (e.g., 'weather', 'news', or 'weather and news'): ").strip()
            if not query:
                print("Please enter a valid query.")
                continue
            
            # Create initial state
            initial_state: AgentState = {
                "messages": [HumanMessage(content=query)],
                "location": location,
                "intent": "unknown",
                "weather_data": "",
                "news_data": ""
            }
            
            print(f"\n🔍 Processing your request for {location}...")
            
            # Execute the graph
            result = research_graph.invoke(initial_state)
            
            # Display the final response
            if result["messages"]:
                final_message = result["messages"][-1].content
                print(f"\n📋 Results:\n{final_message}")
            else:
                print("\n❌ No results found.")
                
        except KeyboardInterrupt:
            print("\n\nGoodbye! 👋")
            break
        except Exception as e:
            print(f"\n❌ Error: {str(e)}")
            print("Please try again.")

if __name__ == "__main__":
    main()
