"""Centralized LLM initialization."""
from langchain.chat_models import init_chat_model
import os
import getpass
from dotenv import load_dotenv

load_dotenv()

# Google API key
if not os.environ.get("GOOGLE_API_KEY"):
    api_key = os.getenv("GOOGLE_API_KEY")
    os.environ["GOOGLE_API_KEY"] = api_key or "DUMMY_KEY_FOR_TESTS"

# Initialize the chat model for use across all reasoning nodes
model = init_chat_model("gemini-2.5-flash", model_provider="google_vertexai")
