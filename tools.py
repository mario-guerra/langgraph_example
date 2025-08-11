"""Search tools for weather and news data."""
import os
from langchain_core.tools import tool
from serpapi import GoogleSearch

@tool
def weather_search(query: str, location: str = "") -> str:
    """Search for current weather information for a specific location."""
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file."
    
    search_query = f"{location} weather {query}" if location else f"{query} weather"
    params = {
        "q": search_query,
        "api_key": api_key,
        "hl": "en",
        "location": location if location else "United States"
    }
    
    try:
        search = GoogleSearch(params)
        results = search.get_dict()
        
        # Look for weather box first (more accurate)
        if "weather_result" in results:
            weather = results["weather_result"]
            location_name = weather.get("location", location)
            temp = weather.get("temperature", "N/A")
            condition = weather.get("weather", "N/A")
            return f"Current weather in {location_name}: {temp}, {condition}"
        
        # Fallback to organic results
        if "organic_results" in results and results["organic_results"]:
            first = results["organic_results"][0]
            title = first.get("title", "")
            snippet = first.get("snippet", "")
            return f"Weather for {location}: {title}\n{snippet}"
            
        return f"No weather information found for {location}"
        
    except Exception as e:
        return f"Error fetching weather data: {str(e)}"

@tool
def news_search(query: str, location: str = "") -> str:
    """Search for recent news related to a location or topic."""
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file."
    
    search_query = f"{location} news {query}" if location else f"{query} news"
    params = {
        "q": search_query,
        "api_key": api_key,
        "hl": "en",
        "tbm": "nws",  # News search
        "num": 3
    }
    
    try:
        search = GoogleSearch(params)
        results = search.get_dict()
        
        if "news_results" in results and results["news_results"]:
            news_items = []
            for item in results["news_results"][:3]:
                title = item.get("title", "")
                snippet = item.get("snippet", "")
                source = item.get("source", "")
                news_items.append(f"• {title} ({source})\n  {snippet}")
            return f"Recent news for {location}:\n\n" + "\n\n".join(news_items)
        
        # Fallback to organic results
        if "organic_results" in results and results["organic_results"]:
            news_items = []
            for item in results["organic_results"][:3]:
                title = item.get("title", "")
                snippet = item.get("snippet", "")
                news_items.append(f"• {title}\n  {snippet}")
            return f"News for {location}:\n\n" + "\n\n".join(news_items)
            
        return f"No recent news found for {location}"
        
    except Exception as e:
        return f"Error fetching news data: {str(e)}"

@tool  
def resolve_location(location: str) -> str:
    """Resolve and validate location names."""
    # Simple location cleaning for now
    # In production, use geocoding APIs like Google Maps or OpenStreetMap
    location = location.strip().title()
    
    # Basic location validation/standardization
    location_mappings = {
        "Nyc": "New York, NY",
        "La": "Los Angeles, CA", 
        "Sf": "San Francisco, CA",
        "Chi": "Chicago, IL"
    }
    
    return location_mappings.get(location, location)
