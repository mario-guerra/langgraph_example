import os
import json
import pytest
import asyncio
import shutil
import warnings

# Suppress deprecation warnings from third-party libraries (fastapi, langchain, starlette)
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=UserWarning)

from fastapi.testclient import TestClient
from web.server import (
    app,
    serialize_message,
    deserialize_message,
    serialize_state,
    deserialize_state,
    session_manager
)
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_sessions(monkeypatch):
    """Redirect session storage to a repo-local temp directory so tests never pollute web/.sessions/."""
    import web.server as srv
    tmp_dir = os.path.join(os.path.dirname(__file__), ".tmp_sessions")
    os.makedirs(tmp_dir, exist_ok=True)
    monkeypatch.setattr(srv, "SESSIONS_DIR", tmp_dir)
    # Reset the in-memory session store
    original_sessions = dict(session_manager.sessions)
    session_manager.sessions.clear()
    yield
    session_manager.sessions.clear()
    session_manager.sessions.update(original_sessions)
    shutil.rmtree(tmp_dir, ignore_errors=True)

# -----------------------------------------------------------------------------
# Mocks & Fixtures to Prevent External LLM/API Hangs during Tests
# -----------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_graph_stream(monkeypatch):
    """Automatically intercepts the graph stream and yields mocked node execution outputs."""
    from web.server import research_graph
    
    def mock_stream(state, *args, **kwargs):
        # Retrieve first message content
        query = state["messages"][0].content if state.get("messages") else ""
        
        # Test Case 1: Ambiguous query triggers clarification
        if "ambiguous" in query.lower():
            # If the user has already answered, proceed to complete
            clarification = state.get("clarification")
            if clarification and not clarification.get("awaiting_response") and clarification.get("user_answer"):
                yield ("updates", {
                    "judge": {
                        "final_answer": f"Calibrated answer after clarifying: {clarification.get('user_answer')}",
                        "answer_confidence": 0.99
                    }
                })
            else:
                yield ("updates", {
                    "clarification": {
                        "clarification": {
                            "question": "Did you mean Austin, TX?",
                            "awaiting_response": True,
                            "user_answer": None
                        }
                    }
                })
            return
            
        # Default Case: Simulates normal execution
        yield ("updates", {
            "intent_parser": {
                "parsed_query": {
                    "topics": ["test"],
                    "location": "Austin, TX",
                    "time_range": "today",
                    "is_ambiguous": False
                }
            }
        })
        import time
        time.sleep(0.3)
        yield ("messages", (AIMessage(content="Mocked final answer"), {}))
        yield ("updates", {
            "judge": {
                "final_answer": "Mocked final answer",
                "answer_confidence": 0.95
            }
        })

    # Monkeypatch the compiled graph's stream method
    monkeypatch.setattr(research_graph, "stream", mock_stream)

# -----------------------------------------------------------------------------
# Unit Tests
# -----------------------------------------------------------------------------

def test_message_serialization():
    from langchain_core.messages import SystemMessage
    human = HumanMessage(content="Hello", id="msg_1")
    ai = AIMessage(content="Hi there", id="msg_2")
    tool = ToolMessage(content="Search result", id="msg_3", tool_call_id="call_1")
    system = SystemMessage(content="You are an assistant", id="msg_4")

    assert serialize_message(human) == {"role": "human", "content": "Hello", "id": "msg_1"}
    assert serialize_message(ai) == {"role": "ai", "content": "Hi there", "id": "msg_2"}
    assert serialize_message(tool) == {"role": "tool", "content": "Search result", "id": "msg_3", "tool_call_id": "call_1"}
    assert serialize_message(system) == {"role": "unknown", "content": "You are an assistant", "id": "msg_4"}

def test_message_deserialization():
    h_dict = {"role": "human", "content": "Hello", "id": "msg_1"}
    a_dict = {"role": "ai", "content": "Hi there", "id": "msg_2"}
    t_dict = {"role": "tool", "content": "Search result", "id": "msg_3", "tool_call_id": "call_1"}

    msg_h = deserialize_message(h_dict)
    msg_a = deserialize_message(a_dict)
    msg_t = deserialize_message(t_dict)

    assert isinstance(msg_h, HumanMessage)
    assert msg_h.content == "Hello"
    assert msg_h.id == "msg_1"

    assert isinstance(msg_a, AIMessage)
    assert msg_a.content == "Hi there"
    assert msg_a.id == "msg_2"

    assert isinstance(msg_t, ToolMessage)
    assert msg_t.content == "Search result"
    assert msg_t.id == "msg_3"
    assert msg_t.tool_call_id == "call_1"

def test_state_serialization_roundtrip():
    initial_state = {
        "messages": [HumanMessage(content="Test query", id="1")],
        "parsed_query": {"topics": ["test"]},
        "clarification": None,
        "step_results": []
    }

    serialized = serialize_state(initial_state)
    assert isinstance(serialized["messages"][0], dict)
    assert serialized["messages"][0]["role"] == "human"

    deserialized = deserialize_state(serialized)
    assert isinstance(deserialized["messages"][0], HumanMessage)
    assert deserialized["messages"][0].content == "Test query"
    assert deserialized["parsed_query"]["topics"] == ["test"]

# -----------------------------------------------------------------------------
# Integration Tests
# -----------------------------------------------------------------------------

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "env" in data

def test_session_lifecycle():
    # 1. Start session
    response = client.post("/api/research/start", json={"query": "Who is the president of the US?"})
    assert response.status_code == 200
    
    # Check headers
    assert "X-Session-Id" in response.headers
    session_id = response.headers["X-Session-Id"]

    # 2. Get session details
    get_res = client.get(f"/api/sessions/{session_id}")
    assert get_res.status_code == 200
    sess_data = get_res.json()
    assert sess_data["session_id"] == session_id
    assert sess_data["query"] == "Who is the president of the US?"
    
    # 3. Check list sessions
    list_res = client.get("/api/sessions")
    assert list_res.status_code == 200
    sessions = list_res.json()
    assert any(s["session_id"] == session_id for s in sessions)

def test_session_not_found():
    response = client.get("/api/sessions/nonexistent-id")
    assert response.status_code == 404

def test_clarify_boundaries():
    # Attempt to clarify nonexistent session
    res_404 = client.post("/api/research/clarify", json={"session_id": "nonexistent", "answer": "yes"})
    assert res_404.status_code == 404

    # Start a normal (non-ambiguous) session
    res_start = client.post("/api/research/start", json={"query": "normal query"})
    sess_id = res_start.headers["X-Session-Id"]

    # Attempt to clarify a session that is NOT awaiting clarification
    res_400 = client.post("/api/research/clarify", json={"session_id": sess_id, "answer": "yes"})
    assert res_400.status_code == 400

def test_clarification_loop():
    # 1. Start ambiguous query session
    response = client.post("/api/research/start", json={"query": "Tell me about an ambiguous topic"})
    assert response.status_code == 200
    session_id = response.headers["X-Session-Id"]

    # 2. Assert session status is "awaiting_clarification"
    get_res = client.get(f"/api/sessions/{session_id}")
    assert get_res.json()["status"] == "awaiting_clarification"

    # 3. Post clarification answer
    clarify_res = client.post("/api/research/clarify", json={"session_id": session_id, "answer": "I mean Austin, TX"})
    assert clarify_res.status_code == 200

    # 4. Verify status progresses to completed
    get_res = client.get(f"/api/sessions/{session_id}")
    assert get_res.json()["status"] == "completed"

def test_session_sorting_order():
    # Create two sessions sequentially
    res1 = client.post("/api/research/start", json={"query": "first query"})
    res2 = client.post("/api/research/start", json={"query": "second query"})
    
    sess1 = res1.headers["X-Session-Id"]
    sess2 = res2.headers["X-Session-Id"]

    # Retrieve all sessions
    list_res = client.get("/api/sessions")
    sessions = list_res.json()

    # The most recent session (sess2) should appear before sess1
    idx1 = next(i for i, s in enumerate(sessions) if s["session_id"] == sess1)
    idx2 = next(i for i, s in enumerate(sessions) if s["session_id"] == sess2)
    assert idx2 < idx1

def test_resiliency_to_corrupted_sessions():
    import web.server as srv
    # Write a corrupted file into the isolated temp sessions dir
    corrupted_file = os.path.join(srv.SESSIONS_DIR, "corrupted.json")
    with open(corrupted_file, "w") as f:
        f.write("invalid json data {")

    # Re-initialize a SessionManager to verify it skips the file without raising exceptions
    from web.server import SessionManager
    mgr = SessionManager()
    assert "corrupted" not in mgr.sessions


@pytest.mark.asyncio
async def test_client_disconnect_during_stream():
    from web.server import sse_event_generator, session_manager
    from fastapi import BackgroundTasks
    
    session_id = "test-disconnect-session"
    query = "Who is the president?"
    initial_state = {
        "messages": [],
        "parsed_query": {},
        "clarification": None,
        "step_results": []
    }
    
    # Pre-populate session in memory
    session_manager.sessions[session_id] = {
        "session_id": session_id,
        "query": query,
        "status": "processing",
        "timestamp": 12345.0,
        "state": initial_state
    }
    
    bg_tasks = BackgroundTasks()
    
    # Create the generator
    gen = sse_event_generator(session_id, query, initial_state, bg_tasks)
    
    # Advance the generator by one step to start it
    first_event = await gen.__anext__()
    assert "event:" in first_event
    
    # Simulate client disconnect by closing the generator
    await gen.aclose()
    
    # Verify the finally block ran and updated the session status to "failed"
    sess = session_manager.get(session_id)
    assert sess["status"] == "failed"


def test_background_thread_exception_handling(monkeypatch):
    from web.server import research_graph
    
    def crash_stream(*args, **kwargs):
        raise BaseException("Fatal background thread crash!")
        yield  # Make it a generator
        
    monkeypatch.setattr(research_graph, "stream", crash_stream)
    
    response = client.post("/api/research/start", json={"query": "Some query"})
    assert response.status_code == 200
    
    # Verify the error details were yielded and stream ended
    lines = [line for line in response.iter_lines() if line]
    assert any("Fatal background thread crash!" in line for line in lines)
    
    session_id = response.headers["X-Session-Id"]
    get_res = client.get(f"/api/sessions/{session_id}")
    assert get_res.json()["status"] == "failed"


def test_session_corruption_resilience():
    import web.server as srv
    # Write a JSON file missing critical metadata keys into the isolated temp dir
    corrupt_file = os.path.join(srv.SESSIONS_DIR, "missing_keys.json")
    with open(corrupt_file, "w") as f:
        json.dump({
            "session_id": "missing_keys"
        }, f)
        
    from web.server import SessionManager
    mgr = SessionManager()
    
    # Check list_sessions does not raise KeyError
    sessions = mgr.list_sessions()
    corrupt_sess = next((s for s in sessions if s["session_id"] == "missing_keys"), None)
    assert corrupt_sess is not None
    assert corrupt_sess["query"] == ""
    assert corrupt_sess["status"] == "unknown"
    assert corrupt_sess["timestamp"] == 0.0
    assert corrupt_sess["final_answer"] is None


def test_concurrent_clarification_prevention():
    # Start ambiguous session to trigger clarification state
    response = client.post("/api/research/start", json={"query": "Tell me about an ambiguous topic"})
    assert response.status_code == 200
    session_id = response.headers["X-Session-Id"]
    
    # Verify status is awaiting_clarification
    get_res = client.get(f"/api/sessions/{session_id}")
    assert get_res.json()["status"] == "awaiting_clarification"
    
    # First clarification post succeeds
    res_1 = client.post("/api/research/clarify", json={"session_id": session_id, "answer": "Option A"})
    assert res_1.status_code == 200
    
    # Second post fails with 400 since status changed to processing/completed
    res_2 = client.post("/api/research/clarify", json={"session_id": session_id, "answer": "Option B"})
    assert res_2.status_code == 400
    assert "is not awaiting clarification" in res_2.json()["detail"]


def test_disk_write_failure_resilience(monkeypatch):
    # Mock open inside server.py to raise OSError when writing to sessions
    original_open = open
    def mock_open(file, mode="r", *args, **kwargs):
        if ".sessions" in str(file) and "w" in mode:
            raise OSError("Disk is full!")
        return original_open(file, mode, *args, **kwargs)
        
    monkeypatch.setattr("builtins.open", mock_open)
    
    response = client.post("/api/research/start", json={"query": "normal query"})
    assert response.status_code == 200
    session_id = response.headers["X-Session-Id"]
    
    # Server should continue responding cleanly, and in-memory state is still updated
    from web.server import session_manager
    sess = session_manager.get(session_id)
    assert sess is not None
    assert sess["query"] == "normal query"


def test_serialization_edge_cases():
    from web.server import serialize_message, deserialize_message
    from langchain_core.messages import SystemMessage
    
    # Serialize SystemMessage (unknown type/role)
    sys_msg = SystemMessage(content="system alerts")
    serialized = serialize_message(sys_msg)
    assert serialized["role"] == "unknown"
    
    # Deserialize unknown role defaults to HumanMessage
    deserialized = deserialize_message({"role": "unknown", "content": "alert content"})
    assert isinstance(deserialized, HumanMessage)
    assert deserialized.content == "alert content"
    
    # Deserializing empty dictionary
    empty_deserialized = deserialize_message({})
    assert isinstance(empty_deserialized, HumanMessage)
    assert empty_deserialized.content == ""
