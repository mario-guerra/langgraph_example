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
import json
# Load environment variables from .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("python-dotenv not installed. To use .env files, run: pip install python-dotenv")

# Set up Google API key
if not os.environ.get("GOOGLE_API_KEY"):
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        api_key = getpass.getpass("Enter API key for Google Gemini: ")
    os.environ["GOOGLE_API_KEY"] = api_key

# Initialize the chat model
model = init_chat_model("gemini-1.5-flash", model_provider="google_genai")


# Define a real search tool using SerpAPI
from serpapi import GoogleSearch

@tool
def web_search(query: str) -> str:
    """Search the web for information on a query using SerpAPI."""
    print(f"Executing web_search with query: {query}")  # Debug log
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file."
    params = {
        "q": query,
        "api_key": api_key,
        "hl": "en"
    }
    search = GoogleSearch(params)
    results = search.get_dict()
    # Get the first organic result
    if "organic_results" in results and results["organic_results"]:
        first = results["organic_results"][0]
        title = first.get("title", "")
        snippet = first.get("snippet", "")
        link = first.get("link", "")
        return f"{title}\n{snippet}\n{link}"
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
    
    # System prompt with clear instructions for structured tool calls
    system_prompt = (
        "You are a research agent. Answer user queries accurately using the web_search tool when external information is needed. "
        "Available tool: web_search (takes a 'query' parameter to search for information). "
        "To call the tool, output a structured response with a 'tool_calls' field, like this:\n"
        "{\n  \"tool_calls\": [{\"name\": \"web_search\", \"arguments\": {\"query\": \"<query>\"}}]\n}\n"
        "Do NOT include the tool call JSON in the content field. Use the tool_calls field for structured tool calls. "
        "If you can answer directly without the tool, provide a concise response. "
        "Reason step-by-step before responding or calling a tool."
    ).replace("{", "{{").replace("}", "}}")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        *messages
    ])
    
    try:
        # Format the prompt
        formatted_prompt = prompt.invoke({})
        # Invoke the model
        response = model_with_tools.invoke(formatted_prompt)
        print("Model response:", response)  # Debug log

        # Check if the response contains a tool call JSON in the content
        tool_calls = None
        if hasattr(response, "content") and response.content:
            import re
            match = re.search(r'\{\s*"tool_calls"\s*:\s*\[.*?\]\s*\}', response.content, re.DOTALL)
            if match:
                try:
                    tool_call_json = json.loads(match.group(0))
                    tool_calls = tool_call_json.get("tool_calls")
                except Exception as parse_err:
                    print(f"Tool call JSON parse error: {parse_err}")

        # If tool_calls found, set it as an attribute on the response
        if tool_calls:
            # Convert 'arguments' to 'args' and add 'id' for each tool call
            for idx, call in enumerate(tool_calls, 1):
                if "arguments" in call:
                    call["args"] = call.pop("arguments")
                if "id" not in call:
                    call["id"] = f"tool_call_{idx}"
            response.tool_calls = tool_calls

        return {"messages": [response]}
    except Exception as e:
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

# Conditional edge: route to tools if tool calls exist
def should_continue(state: AgentState):
    last_message = state["messages"][-1]
    print("Last message:", last_message)  # Debug log
    print("Tool calls:", getattr(last_message, "tool_calls", None))  # Debug log
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END

workflow.add_conditional_edges("agent", should_continue)

# Loop back to agent after tool execution
workflow.add_edge("tools", "agent")

# Compile the graph
research_graph = workflow.compile()

# Prompt user for location
location = input("Enter your location for the weather report: ")

# Run the agent with a weather query for the location
initial_state = {"messages": [HumanMessage(content=f"What is the weather in {location}?")]}
try:
    result = research_graph.invoke(initial_state)
    # Print the final response
    final_message = result["messages"][-1].content
    print("Final response:", final_message)
except Exception as e:
    print(f"Graph execution failed: {str(e)}")