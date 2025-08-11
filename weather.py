import getpass
import os
from typing import TypedDict, Annotated, List
from operator import add
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode

# Set up Google API key
if not os.environ.get("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = getpass.getpass("Enter API key for Google Gemini: ")

# Initialize the chat model
model = init_chat_model("gemini-1.5-flash", model_provider="google_genai")

# Define a dummy search tool (replace with real tool like Tavily in production)
@tool
def web_search(query: str) -> str:
    """Search the web for information on a query."""
    if "xAI" in query.lower():
        return "xAI is a company founded by Elon Musk focusing on understanding the universe through AI. Their products include Grok models."
    return "No relevant results found."

# Bind tools to the model
tools = [web_search]
model_with_tools = model.bind_tools(tools)

# Define the state
class AgentState(TypedDict):
    messages: Annotated[List[HumanMessage | AIMessage | ToolMessage], add]

# Define the agent node
def agent(state: AgentState) -> AgentState:
    messages = state["messages"]
    
    # Enhanced system prompt to ensure tool usage
    system_prompt = (
        "You are a research agent. Your goal is to answer user queries accurately. "
        "You have access to the following tool:\n"
        "- web_search: Search the web for information. Use this for factual queries requiring external data.\n"
        "If the query requires external information, call the web_search tool by outputting a JSON object like: "
        "{\"tool_calls\": [{\"name\": \"web_search\", \"arguments\": {\"query\": \"<query>\"}}]}.\n"
        "If you have sufficient information to answer directly, provide a clear and concise response. "
        "Always reason step-by-step before responding or calling a tool."
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        *messages
    ])
    
    try:
        # Format the prompt
        formatted_prompt = prompt.invoke({})
        # Invoke the model
        response = model_with_tools.invoke(formatted_prompt)
        return {"messages": [response]}
    except Exception as e:
        # Fallback response if model invocation fails
        error_message = AIMessage(content=f"Error invoking model: {str(e)}. Please try again.")
        return {"messages": [error_message]}

# Create the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("agent", agent)
tool_node = ToolNode(tools)
workflow.add_node("tools", tool_node)

# Edges
workflow.add_edge(START, "agent")

# Conditional edge: route to tools if tool calls exist, else end
def should_continue(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END

workflow.add_conditional_edges("agent", should_continue)

# Loop back to agent after tool execution
workflow.add_edge("tools", "agent")

# Compile the graph
research_graph = workflow.compile()

# Run the agent with a query
initial_state = {"messages": [HumanMessage(content="What is xAI?")]}
try:
    result = research_graph.invoke(initial_state)
    # Print the final response
    final_message = result["messages"][-1].content
    print(final_message)
except Exception as e:
    print(f"Graph execution failed: {str(e)}")