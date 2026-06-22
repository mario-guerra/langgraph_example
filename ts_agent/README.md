# ts_agent — TypeScript Multi-Agent Research System

TypeScript port of the Python LangGraph adaptive multi-agent research system.

## Setup

### 1. API Keys

Copy `.env.example` to `.env` and fill in the keys from the root `.env`:

```bash
cp .env.example .env
```

Values needed:
- `GOOGLE_API_KEY` — Google AI Studio key (same as root `.env`)
- `OPENAI_API_KEY` — OpenAI key
- `ANTHROPIC_API_KEY` — Anthropic key  
- `SERPAPI_API_KEY` — SerpAPI key

### 2. Install dependencies

```bash
cd ts_agent   # IMPORTANT: always run from this directory
npm install
```

### 3. Run the demo

```bash
npm run demo
```

Expected output: all 9 nodes fire in sequence, ending with a `🎯 Final Response` and confidence score.

### 4. Type-check (optional)

```bash
npm run typecheck
```

## Architecture

```
src/
  schemas.ts     — Zod schemas (mirrors Python schemas.py)
  state.ts       — LangGraph AgentState annotation
  llm.ts         — LLM instances (Gemini Flash, o3-mini, Claude Sonnet)
  utils.ts       — invokeStructured retry wrapper
  tools.ts       — SerpAPI search functions
  credibility.ts — Credibility scoring node
  agents.ts      — All 9 graph nodes + routing functions
  graph.ts       — StateGraph assembly
  demo.ts        — Headless demo runner
```

## Notes

- Run all `npm` commands from the `ts_agent/` directory — `dotenv` resolves `.env` relative to `process.cwd()`
- Integrated with Orchid SDK for execution tracing and offline playback
- System prompts are verbatim copies from the Python version
