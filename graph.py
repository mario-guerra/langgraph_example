"""Main graph orchestration for the multi-agent system."""
from langgraph.graph import StateGraph, END, START
from state import AgentState
from agents import coordinator_agent, weather_agent, news_agent, summary_agent

def should_get_weather(state: AgentState) -> str:
    """Conditional routing for weather agent."""
    if state["intent"] in ["weather", "both"]:
        return "weather_agent"
    return "news_check"

def should_get_news(state: AgentState) -> str:
    """Conditional routing for news agent.""" 
    if state["intent"] in ["news", "both"]:
        return "news_agent"
    return "summary_agent"

def create_research_graph():
    """Create and compile the research graph."""
    workflow = StateGraph(AgentState)
    
    # Add nodes
    workflow.add_node("coordinator", coordinator_agent)
    workflow.add_node("weather_agent", weather_agent)
    workflow.add_node("news_agent", news_agent)
    workflow.add_node("summary_agent", summary_agent)
    
    # Add edges with conditional routing
    workflow.add_edge(START, "coordinator")
    
    # Conditional routing based on intent
    workflow.add_conditional_edges(
        "coordinator",
        should_get_weather,
        {
            "weather_agent": "weather_agent",
            "news_check": "news_agent"  # Skip weather, go to news check
        }
    )
    
    workflow.add_conditional_edges(
        "weather_agent", 
        should_get_news,
        {
            "news_agent": "news_agent",
            "summary_agent": "summary_agent"  # Skip news, go to summary
        }
    )
    
    workflow.add_edge("news_agent", "summary_agent")
    workflow.add_edge("summary_agent", END)
    
    return workflow.compile()
