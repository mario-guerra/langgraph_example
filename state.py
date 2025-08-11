"""State management for the multi-agent system."""
from typing import TypedDict, Annotated, List, Literal
from operator import add
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

class AgentState(TypedDict):
    """State shared across all agents in the graph."""
    messages: Annotated[List[HumanMessage | AIMessage | ToolMessage], add]
    location: str
    intent: Literal["weather", "news", "both", "unknown"]
    weather_data: str
    news_data: str
