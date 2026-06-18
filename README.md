# OrchidTrace LangGraph Integration Example 🧠🔍

This repository serves as a reference implementation demonstrating how to integrate the **OrchidTrace debugger** with a stateful "Plan-Execute" research framework built with LangGraph. 

By integrating `orchid-sdk`, we are able to capture, inspect, and replay the complex, cyclical execution graph of this Tri-Model Adversarial Architecture (using OpenAI, Anthropic, and Google Vertex AI).

## 🚀 Quick Start & Offline Playback

Before running either mode, ensure you have the [OrchidTrace proxy](https://github.com/mario-guerra/orchid-trace) installed and running in the background.

Choose one of the execution modes below:

### Option 1: Replay Mode / Playback (Deterministic Offline Demo)

This is the easiest way to showcase Orchid Trace. It plays back a recorded execution path completely offline from the included fixture, with **zero external API calls and no credential setup needed**.

1. **Start the Orchid Proxy** (configured with your `ORCHID_API_KEY`):
   ```bash
   docker run -d \
     --name orchid-proxy \
     -p 4320:4320 \
     -p 4321:4321 \
     -v orchid-data:/data \
     -e ORCHID_API_KEY=your_proxy_api_key_here \
     -e ORCHID_DB_PATH=/data/orchid.db \
     ghcr.io/mario-guerra/orchid-proxy:latest
   ```

2. **Import the Included Demo Fixture** into the proxy:
   ```bash
   curl -X POST http://localhost:4321/v1/sessions/import \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your_proxy_api_key_here" \
     -d @/path/to/project/orchid_langgraph_demo_fixture.json
   ```

3. **Configure your Local Environment** for replay:
   Create a `.env` file in the project root:
   ```env
   ORCHID_API_KEY=your_proxy_api_key_here
   ORCHID_MODE=replay
   ORCHID_SESSION_ID="Orchid LangGraph Demo"
   ```

4. **Initialize and Activate Virtual Environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate    # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

5. **Run the Playback**:
   ```bash
   python orchid_demo.py
   ```

6. **View the Traces**: Open `http://localhost:4321` in your browser, enter your `ORCHID_API_KEY` to authorize, and inspect the session `"Orchid LangGraph Demo"`.

---

### Option 2: Capture Mode (Live Recording)

To run the multi-agent system live, query the real LLMs, and record your own custom trace session:

1. **Set Up Upstream Credentials** in your `.env` file:
   ```env
   SERPAPI_API_KEY=your_serpapi_key_here
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ORCHID_API_KEY=your_proxy_api_key_here
   ```

2. **Authenticate with Google Cloud** (for Vertex AI):
   ```bash
   gcloud auth application-default login
   ```

3. **Run the Demo**:
   ```bash
   # Ensure ORCHID_MODE is NOT set to 'replay' in your environment or .env
   python orchid_demo.py
   ```

*Note: The `orchid_demo.py` script automatically initializes the integration via `import orchid; orchid.init()`.*


## 🏗️ Architecture Overview

Unlike traditional DAGs, this system uses a dynamic, cyclical **Plan-Execute** architecture. The graph routes intelligently based on the LLM's own uncertainty and evaluation signals. OrchidTrace is used to debug these dynamic routing decisions.

```mermaid
graph TD
  classDef llmNode fill:#4c1d95,stroke:#8b5cf6,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;

  A["User Input"] --> B["Intent Parser (LLM)"]:::llmNode
  B --> C{"Ambiguous?"}
  C -->|Yes| D["Clarification Node (LLM)"]:::llmNode
  D -.->|"User Input"| B
  C -->|No| E["Planner Node (LLM)"]:::llmNode
  E --> F["Executor: Run Tool"]
  F --> G["Step Evaluator (LLM)"]:::llmNode
  G -->|Retry| F
  G -->|Accept| H["Evidence Evaluator (LLM)"]:::llmNode
  H --> I{"Sufficient?"}
  I -->|Augment| F
  I -->|Proceed| J["Credibility Scorer (LLM)"]:::llmNode
  J --> K["Debate: Optimist (LLM)"]:::llmNode
  K --> L["Debate: Skeptic (LLM)"]:::llmNode
  L --> M["Judge (LLM)"]:::llmNode
  M --> N["Final Answer"]
```

## 📁 Repository Layout

```
langgraph_example/
├── orchid_demo.py   # Automated integration tests with Orchid capture mode enabled
├── main.py          # Interactive CLI with real-time state streaming
├── graph.py         # Dynamic graph routing and orchestration
├── state.py         # Complex AgentState definitions
├── schemas.py       # Pydantic models enforcing strict LLM structured outputs
├── agents.py        # Intent, Clarification, Executor, and Evaluator nodes
├── planner.py       # Autonomous research planning node
├── credibility.py   # Source credibility scoring engine
├── debate.py        # Optimist, Skeptic, and Judge nodes
├── utils.py         # LLM utilities (e.g., auto-correcting validation loops)
├── llm.py           # Centralized Vertex AI model initialization
└── tools.py         # Tool registry (SerpAPI web, news, weather search)
```

## 🔧 Setup & Dependencies

### Prerequisites
- Python 3.11+
- Google Cloud Platform account (with Vertex AI enabled)
- `gcloud` CLI installed and authenticated
- SerpAPI key
- OpenAI API key
- Anthropic API key

### API Keys & Auth
1. **Vertex AI**: We use `langchain-google-vertexai`. Ensure you have authenticated locally via `gcloud auth application-default login` and set your quota project.
2. **SerpAPI, LLMs, & Orchid Proxy**: Create a `.env` file and add:
   ```env
   SERPAPI_API_KEY=your_key_here
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ORCHID_API_KEY=your_proxy_api_key_here
   ```

## 🔍 Troubleshooting

- **Unauthorized: 401 POST http://127.0.0.1:4320**: The Orchid proxy runs in secure mode and requires an API key to accept requests. Ensure `ORCHID_API_KEY` is set in your `.env` file.
- **ModuleNotFoundError: No module named 'orchid'**: Ensure you have run `pip install -r requirements.txt` to install the `orchid-sdk`.
- **429 RESOURCE_EXHAUSTED / NOT_FOUND**: This indicates a Google API issue. Ensure you are authenticated via `gcloud auth application-default login`.
- **Missing SerpAPI Key**: The Executor will safely catch the missing key and return an error string, but no actual research will occur. Add it to your `.env`.

## 📝 License

MIT License — Free for learning, refactoring, and agentic experimentation.
