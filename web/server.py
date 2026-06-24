import os
import uuid
import json
import queue
import time
import logging
import asyncio
from typing import Dict, List, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Project imports
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from py_agent.graph import create_research_graph
from py_agent.state import AgentState

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("research_server")

app = FastAPI(title="Multi-Agent Research Assistant API")

# Enable CORS for local client development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Data Models & Serialization Helpers
# -----------------------------------------------------------------------------

class StartRequest(BaseModel):
    query: str

class ClarifyRequest(BaseModel):
    session_id: str
    answer: str

def serialize_message(msg) -> dict:
    """Safely convert LangChain messages to JSON-serializable dictionaries."""
    if isinstance(msg, AIMessage):
        role = "ai"
    elif isinstance(msg, HumanMessage):
        role = "human"
    elif isinstance(msg, ToolMessage):
        role = "tool"
    else:
        role = "unknown"
    
    result = {
        "role": role,
        "content": getattr(msg, "content", ""),
        "id": getattr(msg, "id", None)
    }
    if role == "tool":
        result["tool_call_id"] = getattr(msg, "tool_call_id", "")
    return result

def deserialize_message(msg_dict: dict):
    """Reconstruct LangChain message objects from stored JSON structures."""
    role = msg_dict.get("role")
    content = msg_dict.get("content", "")
    msg_id = msg_dict.get("id")
    if role == "human":
        return HumanMessage(content=content, id=msg_id)
    elif role == "ai":
        return AIMessage(content=content, id=msg_id)
    elif role == "tool":
        return ToolMessage(content=content, id=msg_id, tool_call_id=msg_dict.get("tool_call_id", "dummy_tool_call_id"))
    return HumanMessage(content=content, id=msg_id)

def serialize_state(state: dict) -> dict:
    """Prepares the entire AgentState dictionary for JSON serialization."""
    serialized = dict(state)
    if "messages" in serialized:
        serialized["messages"] = [serialize_message(m) for m in serialized["messages"]]
    return serialized

def deserialize_state(state_dict: dict) -> dict:
    """Restores the complete AgentState dictionary including message objects."""
    deserialized = dict(state_dict)
    if "messages" in deserialized:
        deserialized["messages"] = [deserialize_message(m) for m in deserialized["messages"]]
    return deserialized

# -----------------------------------------------------------------------------
# Session Persistence Manager (Async Background File I/O)
# -----------------------------------------------------------------------------

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), ".sessions")

class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, dict] = {}
        os.makedirs(SESSIONS_DIR, exist_ok=True)
        self._load_from_disk()

    def _load_from_disk(self):
        """Pre-populate the store with historical runs from the filesystem."""
        try:
            for filename in os.listdir(SESSIONS_DIR):
                if filename.endswith(".json"):
                    filepath = os.path.join(SESSIONS_DIR, filename)
                    try:
                        with open(filepath, "r") as f:
                            data = json.load(f)
                            session_id = data.get("session_id")
                            if session_id:
                                self.sessions[session_id] = data
                    except Exception as e:
                        logger.error(f"Failed to load session file {filename}: {e}")
        except Exception as e:
            logger.error(f"Error loading sessions directory: {e}")

    def get(self, session_id: str) -> Optional[dict]:
        return self.sessions.get(session_id)

    def list_sessions(self) -> List[dict]:
        """Returns metadata list of all historical runs sorted by timestamp desc."""
        lst = []
        for s_id, data in self.sessions.items():
            state_data = data.get("state")
            final_answer = None
            if isinstance(state_data, dict):
                final_answer = state_data.get("final_answer")
            lst.append({
                "session_id": s_id,
                "query": data.get("query", ""),
                "status": data.get("status", "unknown"),
                "timestamp": data.get("timestamp", 0.0),
                "final_answer": final_answer
            })
        return sorted(lst, key=lambda x: x.get("timestamp", 0.0) or 0.0, reverse=True)

    def update_session(self, session_id: str, query: str, status: str, state: dict, background_tasks: BackgroundTasks):
        """Updates internal memory state and schedules async disk save."""
        session_data = {
            "session_id": session_id,
            "query": query,
            "status": status,
            "timestamp": datetime.utcnow().timestamp(),
            "state": serialize_state(state)
        }
        self.sessions[session_id] = session_data
        background_tasks.add_task(self._write_to_disk, session_id, session_data)

    def _write_to_disk(self, session_id: str, session_data: dict):
        """Sync worker task called in background to prevent blocking ASGI thread."""
        try:
            filepath = os.path.join(SESSIONS_DIR, f"{session_id}.json")
            with open(filepath, "w") as f:
                json.dump(session_data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist session {session_id} to disk: {e}")

    def delete_session(self, session_id: str):
        """Delete session from memory and delete its file from SESSIONS_DIR."""
        if session_id in self.sessions:
            del self.sessions[session_id]
        filepath = os.path.join(SESSIONS_DIR, f"{session_id}.json")
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception as e:
                logger.error(f"Failed to delete session file {filepath}: {e}")

session_manager = SessionManager()
research_graph = create_research_graph()

# -----------------------------------------------------------------------------
# Thread-Safe Graph Execution Bridge
# -----------------------------------------------------------------------------

def run_sync_graph_stream(state: dict, event_queue: queue.Queue):
    """Executes compiled LangGraph synchronous stream inside worker thread context.
       Pushes node events to a thread-safe Queue."""
    try:
        # stream_mode returns tuples of (mode, payload)
        for chunk in research_graph.stream(state, stream_mode=["messages", "updates"]):
            if len(chunk) == 2:
                mode, payload = chunk
                if mode == "messages":
                    msg, metadata = payload
                    # Yield incremental text chunks from AI assistant messages
                    if isinstance(msg, AIMessage) and msg.content:
                        event_queue.put({
                            "type": "message",
                            "data": {
                                "content": msg.content,
                                "role": "ai"
                            }
                        })
                elif mode == "updates":
                    # Yield node status transitions
                    for node_name, state_update in payload.items():
                        event_queue.put({
                            "type": "node_update",
                            "data": {
                                "node": node_name,
                                "state_update": serialize_state(state_update)
                            }
                        })
        event_queue.put(None)  # Sentinel indicates successful execution complete
    except BaseException as e:
        logger.exception("Error during graph stream execution:")
        event_queue.put(e)

# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "env": {
            "has_openai": bool(os.getenv("OPENAI_API_KEY")),
            "has_anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
            "has_google_vertex": bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")),
            "has_serpapi": bool(os.getenv("SERPAPI_API_KEY"))
        }
    }

@app.get("/api/sessions")
def list_sessions():
    return session_manager.list_sessions()

@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    sess = session_manager.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess

@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    sess = session_manager.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    session_manager.delete_session(session_id)
    return {"status": "success", "session_id": session_id}

async def sse_event_generator(session_id: str, query: str, initial_state: dict, background_tasks: BackgroundTasks):
    """Consumes the queue populated by worker thread, translates updates to SSE, 
       and updates the persistent store asynchronously."""
    event_queue = queue.Queue()
    current_state = dict(initial_state)

    # Spawn synchronous graph runner in separate OS worker thread
    task = asyncio.create_task(
        asyncio.to_thread(run_sync_graph_stream, current_state, event_queue)
    )

    status = "processing"
    stream_completed = False
    
    try:
        while True:
            try:
                # Poll queue block-free
                item = event_queue.get_nowait()
            except queue.Empty:
                if task.done():
                    logger.error("Background execution thread finished unexpectedly without sentinel.")
                    break
                await asyncio.sleep(0.05)
                continue

            if item is None:
                # Graph execution finished successfully
                stream_completed = True
                break
                
            if isinstance(item, BaseException):
                # Graph execution threw an error
                status = "failed"
                yield f"event: error\ndata: {json.dumps({'message': str(item)})}\n\n"
                session_manager.update_session(session_id, query, status, current_state, background_tasks)
                stream_completed = True
                return

            # Handle nodes update to update local state representation
            if item["type"] == "node_update":
                node_name = item["data"]["node"]
                state_update = item["data"]["state_update"]

                # Merge lists manually
                for k, v in state_update.items():
                    if k == "messages":
                        # De-duplicate messages by id/content to prevent exponential duplication
                        existing_ids = set()
                        for m in current_state.get("messages", []):
                            if isinstance(m, AIMessage):
                                role = "ai"
                            elif isinstance(m, HumanMessage):
                                role = "human"
                            elif isinstance(m, ToolMessage):
                                role = "tool"
                            else:
                                role = "unknown"
                            m_id = getattr(m, "id", None) or f"{role}:{getattr(m, 'content', '')}"
                            existing_ids.add(str(m_id))
                        
                        new_messages = []
                        for m_dict in v:
                            m_id = m_dict.get("id") or f"{m_dict.get('role', 'unknown')}:{m_dict.get('content', '')}"
                            if str(m_id) not in existing_ids:
                                new_messages.append(deserialize_message(m_dict))
                                existing_ids.add(str(m_id))
                        
                        current_state[k] = current_state.get(k, []) + new_messages
                    else:
                        current_state[k] = v

                # Check if execution paused for user clarification
                clarification = current_state.get("clarification")
                if clarification and clarification.get("awaiting_response") and not clarification.get("user_answer"):
                    status = "awaiting_clarification"
                    yield f"event: clarification\ndata: {json.dumps(clarification)}\n\n"
                    session_manager.update_session(session_id, query, status, current_state, background_tasks)
                    stream_completed = True
                    return

            # Forward formatted event to client
            yield f"event: {item['type']}\ndata: {json.dumps(item['data'])}\n\n"

        # If stream reaches this point, execution finished completely
        status = "completed"
        yield f"event: complete\ndata: {json.dumps(serialize_state(current_state))}\n\n"
        session_manager.update_session(session_id, query, status, current_state, background_tasks)
        stream_completed = True

    finally:
        if not stream_completed:
            logger.warning(f"SSE client disconnected from session {session_id} prematurely.")
            current_status = "processing"
            sess = session_manager.get(session_id)
            if sess:
                current_status = sess.get("status", "processing")
            if current_status in ("processing", "awaiting_clarification"):
                session_manager.update_session(session_id, query, "failed", current_state, background_tasks)


@app.post("/api/research/start")
async def start_research(req: StartRequest, background_tasks: BackgroundTasks):
    session_id = str(uuid.uuid4())
    initial_state: AgentState = {
        "messages": [HumanMessage(content=req.query)],
        "parsed_query": {},
        "clarification": None,
        "research_plan": None,
        "step_results": [],
        "scratchpad": [],
        "retry_counts": {},
        "augmentation_passes": 0,
        "optimist_argument": None,
        "skeptic_argument": None,
        "final_answer": None,
        "answer_confidence": None
    }
    
    # Save the initial "processing" state
    session_manager.update_session(session_id, req.query, "processing", initial_state, background_tasks)
    
    return StreamingResponse(
        sse_event_generator(session_id, req.query, initial_state, background_tasks),
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Session-Id": session_id
        }
    )

@app.post("/api/research/clarify")
async def clarify_research(req: ClarifyRequest, background_tasks: BackgroundTasks):
    sess = session_manager.get(req.session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
        
    if sess.get("status") != "awaiting_clarification":
        raise HTTPException(status_code=400, detail="Session is not awaiting clarification")

    state = deserialize_state(sess["state"])
    clarification = state.get("clarification")
    
    if not clarification or not clarification.get("awaiting_response"):
        raise HTTPException(status_code=400, detail="Session is not awaiting clarification")

    # Update state values to resume execution
    clarification["user_answer"] = req.answer
    clarification["awaiting_response"] = False
    state["clarification"] = clarification
    state["messages"].append(HumanMessage(content=req.answer))

    session_manager.update_session(req.session_id, sess["query"], "processing", state, background_tasks)

    return StreamingResponse(
        sse_event_generator(req.session_id, sess["query"], state, background_tasks),
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Session-Id": req.session_id
        }
    )

# Serve SPA (Frontend files must be present under static/)
try:
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
except Exception as e:
    logger.warning(f"Static directory mounting skipped: {e}")
