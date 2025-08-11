"""Agent implementations for the multi-agent system."""
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate
from state import AgentState
from tools import weather_search, news_search, resolve_location

# Initialize the chat model
model = init_chat_model("gemini-1.5-flash", model_provider="google_genai")

def coordinator_agent(state: AgentState) -> AgentState:
    """Analyze user intent and route to appropriate agents."""
    messages = state["messages"]
    if not messages:
        return state
    
    user_message = str(messages[0].content).lower()
    location = state.get("location", "")
    
    # Enhanced intent detection
    has_weather = any(word in user_message for word in ["weather", "temperature", "forecast", "rain", "sunny", "cloudy"])
    has_news = any(word in user_message for word in ["news", "headlines", "current events", "breaking"])
    
    if has_weather and has_news:
        intent = "both"
    elif has_weather:
        intent = "weather" 
    elif has_news:
        intent = "news"
    else:
        intent = "unknown"
    
    # Clean up location
    if location:
        location = resolve_location.invoke({"location": location})
    
    new_state = state.copy()
    new_state["intent"] = intent
    new_state["location"] = location
    
    return new_state

def weather_agent(state: AgentState) -> AgentState:
    """Handle weather-related queries using LLM + tools."""
    if state["intent"] not in ["weather", "both"]:
        return state
    
    location = state["location"]
    user_query = state["messages"][0].content if state["messages"] else ""
    
    # Use the weather search tool
    weather_result = weather_search.invoke({"query": user_query, "location": location})
    
    # Create a prompt for the LLM to format the weather response
    prompt = ChatPromptTemplate.from_template(
        "Based on this weather data: {weather_data}\n"
        "User asked: {user_query}\n"
        "Location: {location}\n\n"
        "Provide a helpful, conversational response about the weather. "
        "Be specific and include relevant details."
    )
    
    formatted_prompt = prompt.format(
        weather_data=weather_result,
        user_query=user_query,
        location=location
    )
    
    response = model.invoke([HumanMessage(content=formatted_prompt)])
    
    new_state = state.copy()
    new_state["weather_data"] = str(response.content)
    new_state["messages"].append(AIMessage(content=f"Weather: {response.content}"))
    
    return new_state

def news_agent(state: AgentState) -> AgentState:
    """Handle news-related queries using LLM + tools."""
    if state["intent"] not in ["news", "both"]:
        return state
    
    location = state["location"]
    user_query = state["messages"][0].content if state["messages"] else ""
    
    # Use the news search tool
    news_result = news_search.invoke({"query": user_query, "location": location})
    
    # Create a prompt for the LLM to format the news response
    prompt = ChatPromptTemplate.from_template(
        "Based on this news data: {news_data}\n"
        "User asked: {user_query}\n"
        "Location: {location}\n\n"
        "Provide a helpful summary of the relevant news. "
        "Be informative and highlight the most important points."
    )
    
    formatted_prompt = prompt.format(
        news_data=news_result,
        user_query=user_query,
        location=location
    )
    
    response = model.invoke([HumanMessage(content=formatted_prompt)])
    
    new_state = state.copy()
    new_state["news_data"] = str(response.content)
    new_state["messages"].append(AIMessage(content=f"News: {response.content}"))
    
    return new_state

def summary_agent(state: AgentState) -> AgentState:
    """Combine results from weather and news agents into a final response."""
    weather_data = state.get("weather_data", "")
    news_data = state.get("news_data", "")
    intent = state["intent"]
    location = state["location"]
    
    if intent == "unknown":
        return {
            **state,
            "messages": [AIMessage(content="I can help you with weather information and news. Please ask about the weather or recent news for a specific location.")]
        }
    
    # Create final summary based on available data
    if intent == "both" and weather_data and news_data:
        prompt = ChatPromptTemplate.from_template(
            "Combine this weather and news information for {location}:\n\n"
            "WEATHER:\n{weather_data}\n\n"
            "NEWS:\n{news_data}\n\n"
            "Provide a comprehensive, well-organized response that addresses both topics."
        )
        formatted_prompt = prompt.format(
            location=location,
            weather_data=weather_data,
            news_data=news_data
        )
    elif weather_data:
        formatted_prompt = weather_data
    elif news_data:
        formatted_prompt = news_data
    else:
        formatted_prompt = f"I couldn't find {intent} information for {location}. Please try again with a different location or check your API keys."
    
    if intent == "both":
        response = model.invoke([HumanMessage(content=formatted_prompt)])
        final_content = response.content
    else:
        final_content = formatted_prompt
    
    return {
        **state,
        "messages": [AIMessage(content=final_content)]
    }
