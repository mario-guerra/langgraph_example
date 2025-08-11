# LangGraph Weather Agent Example

This project is intended for self-directed learning about Langchain, LangGraph, and agent orchestration. It is **not** intended for production use or as a productized solution.

It demonstrates a LangGraph-powered research agent that can answer questions and fetch live weather reports for any location using Google search results via SerpAPI.

## Features
- Uses Langchain, LangGraph, and Gemini (Google GenAI) for agent orchestration
- Real-time web search via SerpAPI
- Prompts user for location and returns a weather report
- Reads API keys from a `.env` file for security

## Setup

### 1. Clone the repository
```
git clone <your-repo-url>
cd langgraph_example
```

### 2. Install dependencies
```
pip install -r requirements.txt
```

### 3. Get API Keys
- **Google Gemini API Key**: For Gemini model access
- **SerpAPI Key**: For web search

### 4. Create a `.env` file
```
GOOGLE_API_KEY=your-google-gemini-key-here
SERPAPI_API_KEY=your-serpapi-key-here
```

### 5. Run the agent
```
python weather.py
```

You will be prompted to enter your location. The agent will return a weather report for that location using live search results.

## File Overview
- `weather.py`: Main agent code
- `requirements.txt`: Python dependencies
- `.env`: API keys (not included in repo)

## Notes
- Make sure your API keys are valid and have sufficient quota.
- For best results, use specific location names (e.g., "New York, NY" or "London, UK").

## License
MIT
