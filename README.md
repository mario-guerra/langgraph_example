# Multi-Agent Adversarial Research Engine 🧠🔍

This repository is a reference implementation of a stateful **Plan-Execute Research Assistant** built on LangGraph. It implements a Tri-Model Adversarial Architecture (using OpenAI, Anthropic, and Google Vertex AI) to autonomously investigate complex queries, evaluate sources, debate claims from opposing viewpoints, and compile synthesis verdicts.

To visualize, debug, and trace the dynamic cyclical graphs of this system, the project features a **Web Dashboard UI** and includes demo integrations with the **OrchidTrace proxy debugger** for both **Python** and **TypeScript** execution layers.

---

## 🚀 Quick Start & Offline Playback

### 1. Clone this repository

To run the local demos or inspect the codebase, clone the repository and navigate into it:

```bash
git clone https://github.com/mario-guerra/langgraph_example.git
cd langgraph_example
```

### 2. Spin up the local demo proxy

To explore the pre-seeded Python demo trace or run the agent code locally, spin up the demo proxy container:

```bash
API_KEY="orchid_demo_8675309"
docker run --pull=always -d --name orchid-proxy-demo \
  -p 4320:4320 -p 4321:4321 \
  -e ORCHID_API_KEY=$API_KEY \
  -e ORCHID_DEMO=1 \
  -e ORCHID_RETENTION_DAYS=0 \
  ghcr.io/mario-guerra/orchid-proxy
```

- **Explore Pre-seeded Python Trace**: Open `http://localhost:4321` in your browser and enter the API key `orchid_demo_8675309` to inspect the pre-seeded Python trace session.
- **Run Local Demos**: Keep this container running and configure your local environments (Python or TypeScript) to point to it using the API key `orchid_demo_8675309` as described below.


---

### Option 1: Python Implementation

#### 1. Replay Mode / Playback (Deterministic Offline Demo)
Plays back a recorded execution path completely offline from the pre-seeded Python fixture. No external API keys or credentials needed.

1. **Configure your Local Environment**:
   Create a `.env` file in the project root by running:

   - **macOS / Linux**:
     ```bash
     printf 'ORCHID_API_KEY=orchid_demo_8675309\nORCHID_MODE=replay\nORCHID_SESSION_ID="Orchid LangGraph Demo"\n' > .env
     ```
   - **Windows (PowerShell)**:
     ```powershell
     'ORCHID_API_KEY=orchid_demo_8675309', 'ORCHID_MODE=replay', 'ORCHID_SESSION_ID="Orchid LangGraph Demo"' | Out-File -Encoding utf8 .env
     ```
2. **Initialize and Activate Virtual Environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate    # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Run the Playback**:
   ```bash
   python -m py_agent.orchid_demo
   ```
   *What to expect*: The script will execute the multi-agent graph nodes (e.g., `[Node: intent_parser] Executed`, `[Node: planner] Executed`) sequentially and output a final synthesis verdict. Because you are in `replay` mode, these requests are intercepted and served instantly by the local Orchid proxy from the pre-seeded fixture without making actual API calls.

4. **View the Traces**: Open `http://localhost:4321` in your browser, log in with the API key `orchid_demo_8675309`, and select the `"Orchid LangGraph Demo"` session.
   *What to expect*: You'll see a complete chronological trace of the agent's run, including the prompt inputs, tool execution payloads, model parameters, and raw responses for every step in the Plan-Execute loop.


#### 2. Capture Mode (Live Recording)
To run the Python multi-agent system live, query real LLMs, and record your own custom trace session:

1. **Set Up Upstream Credentials** in the root `.env` file:
   ```env
   SERPAPI_API_KEY=your_serpapi_key_here
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ORCHID_API_KEY=orchid_demo_8675309
   ```
2. **Authenticate with Google Cloud** (for Vertex AI):
   ```bash
   gcloud auth application-default login
   ```
3. **Run the Demo**:
   Ensure `ORCHID_MODE` is NOT set to `replay` in `.env` (or set it to `capture`), then:
   ```bash
   python -m py_agent.orchid_demo
   ```

---

### Option 2: TypeScript Implementation (`ts_agent`)

#### 1. Replay Mode / Playback (Deterministic Offline Demo)
Plays back a recorded execution path completely offline from the included TypeScript fixture. No external API keys or credentials needed.

1. **Import the Included TypeScript Demo Fixture** into the proxy:
   ```bash
   curl -X POST http://localhost:4321/v1/sessions/import \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer orchid_demo_8675309" \
     -d @orchid_langgraph_demo_fixture_typescript.json
   ```
2. **Configure your Local Environment**:
   Create a `.env` file inside the `ts_agent/` directory by running:

   - **macOS / Linux**:
     ```bash
     printf 'ORCHID_API_KEY=orchid_demo_8675309\nORCHID_MODE=replay\nORCHID_SESSION_ID="Orchid LangGraph Demo - TypeScript"\n' > ts_agent/.env
     ```
   - **Windows (PowerShell)**:
     ```powershell
     'ORCHID_API_KEY=orchid_demo_8675309', 'ORCHID_MODE=replay', 'ORCHID_SESSION_ID="Orchid LangGraph Demo - TypeScript"' | Out-File -Encoding utf8 ts_agent/.env
     ```
3. **Install Dependencies**:
   ```bash
   cd ts_agent
   npm install
   ```
4. **Run the Playback**:
   ```bash
   npm run demo
   ```
   *What to expect*: The script runs the TypeScript implementation of the agent graph. Because of `replay` mode, the local proxy will intercept and serve the LLM calls instantly from the imported TS fixture.

5. **View the Traces**: Open `http://localhost:4321` in your browser, log in with the API key `orchid_demo_8675309`, and select the `"Orchid LangGraph Demo - TypeScript"` session.
   *What to expect*: You'll see the complete trace hierarchy showing the node states, tools called, and LLM completions.

#### 2. Capture Mode (Live Recording)
To run the TypeScript multi-agent system live, query real LLMs, and record your own custom trace session:

1. **Set Up Upstream Credentials** in `ts_agent/.env`:
   ```env
   GOOGLE_API_KEY=your_google_key_here
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   SERPAPI_API_KEY=your_serpapi_key_here
   ORCHID_API_KEY=orchid_demo_8675309
   ```
2. **Authenticate with Google Cloud** (for Vertex AI):
   ```bash
   gcloud auth application-default login
   ```
3. **Run the Demo**:
   Ensure `ORCHID_MODE` is NOT set to `replay` in `ts_agent/.env`, then:
   ```bash
   npm run demo
   ```

### Option 3: Interactive Web Dashboard (FastAPI + HTML5/CSS3)

![Web Dashboard Interface](web_ui.png)

Run the full adversarial research multi-agent system inside a web interface. Watch the agent engine's live query expansion, evidence analysis, source credibility checks, and debate loops in real-time.

1. **Activate your Python Virtual Environment**:
   ```bash
   source .venv/bin/activate
   ```
2. **Start the FastAPI Development Server**:
   ```bash
   uvicorn web.server:app --reload --port 8000
   ```
3. **Open the Dashboard**:
   Navigate to `http://localhost:8000` in your web browser.

#### Dashboard Features:
- **Unified Chronological Flow Map**: A centered, auto-scrolling graph mapping the step-by-step agent lifecycle from query parsing to synthesis judge.
- **Dynamic Text Scaling Controls**: Use the `A−`, `A`, and `A+` buttons in the global header to scale the dashboard typography dynamically to your liking (saved and persisted via `localStorage`).
- **Markdown Tables Compiler**: Native compiler for complex LLM synthesis data, rendering tables with clean, glassmorphic styles and interactive citation highlights.
- **Historical Run Manager**: Inspect past research sessions synced dynamically via Server-Sent Events, or delete old sessions directly from the sidebar.

---

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

---

## 📁 Repository Layout

```
langgraph_example/
├── py_agent/        # Python implementation of the Adversarial Research Agent
│   ├── __init__.py    # Exposes create_research_graph
│   ├── agents.py      # Intent, Clarification, Executor, and Evaluator nodes
│   ├── config.py      # Configuration and API key setup
│   ├── credibility.py # Source credibility scoring engine
│   ├── debate.py      # Optimist, Skeptic, and Judge nodes
│   ├── graph.py       # StateGraph definition and routing logic
│   ├── llm.py         # Centralized Vertex AI model initialization
│   ├── planner.py     # Autonomous research planning node
│   ├── schemas.py     # Pydantic models enforcing structured output validation
│   ├── state.py       # AgentState definitions
│   ├── tools.py       # Tool registry (SerpAPI web, news, weather search)
│   ├── utils.py       # LLM structured output query and validation helpers
│   ├── main.py        # Interactive CLI with real-time state streaming (Python)
│   └── orchid_demo.py # Automated integration tests with Orchid capture mode enabled (Python)
├── ts_agent/        # TypeScript port of the agent system with Orchid integration
│   ├── src/
│   │   ├── agents.ts      # Graph nodes and routing functions
│   │   ├── credibility.ts # Credibility scorer node
│   │   ├── demo.ts        # CLI runner with Orchid SDK initialization
│   │   ├── graph.ts       # StateGraph construction
│   │   ├── llm.ts         # LLM declarations (Gemini, o3-mini, Claude)
│   │   ├── schemas.ts     # Zod models for structured output validation
│   │   ├── state.ts       # Reducers and state annotation definitions
│   │   ├── tools.ts       # Query tool implementations
│   │   └── utils.ts       # Retry helpers and validation correction
│   ├── package.json       # Project dependencies
│   └── tsconfig.json      # TypeScript configuration
├── web/             # Interactive Dashboard Web Server
│   ├── .sessions/     # Persistent storage for historical run JSON logs
│   ├── static/        # Frontend Dashboard client assets (HTML, CSS, JS)
│   └── server.py      # FastAPI server serving API, static UI, and SSE streams
├── tests/           # Integration tests for server endpoints
└── web_ui.png       # Web UI Screenshot
```

---

## 🔧 Setup & Dependencies

### Prerequisites
- Python 3.11+ (for Python implementation)
- Node.js 18+ (for TypeScript implementation)
- Google Cloud Platform account (with Vertex AI enabled)
- `gcloud` CLI installed and authenticated
- SerpAPI key
- OpenAI API key
- Anthropic API key

### API Keys & Auth
1. **Vertex AI**: We use `langchain-google-vertexai` / `@langchain/google-vertexai`. Ensure you have authenticated locally via `gcloud auth application-default login` and set your quota project.
2. **SerpAPI, LLMs, & Orchid Proxy**: Create a `.env` file (and/or `ts_agent/.env`) and add:
   ```env
   SERPAPI_API_KEY=your_key_here
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ORCHID_API_KEY=orchid_demo_8675309
   ```

---

## 🔍 Troubleshooting

- **Unauthorized: 401 POST http://127.0.0.1:4320**: The Orchid proxy runs in secure mode and requires an API key to accept requests. Ensure `ORCHID_API_KEY` is set in your `.env` file.
- **ModuleNotFoundError / Cannot find module**: Ensure you have run `pip install -r requirements.txt` (Python) or `npm install` inside `ts_agent/` (TypeScript).
- **429 RESOURCE_EXHAUSTED / NOT_FOUND**: This indicates a Google API issue. Ensure you are authenticated via `gcloud auth application-default login`.
- **Missing SerpAPI Key**: The Executor will safely catch the missing key and return an error string, but no actual research will occur. Add it to your `.env`.

## 📝 License

MIT License — Free for learning, refactoring, and agentic experimentation.
