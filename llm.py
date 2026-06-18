import os
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

load_dotenv()

# We expect setup_api_keys to handle the interactive parts if missing,
# but we need to ensure they are at least somewhat present for imports.
for key in ["GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ORCHID_API_KEY"]:
    if not os.environ.get(key):
        os.environ[key] = os.getenv(key) or f"DUMMY_{key}"

# 1. Google (Workhorses for Speed & Volume)
project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or "orchid-demo-project"
gemini_flash = init_chat_model("gemini-2.5-flash", model_provider="google_vertexai", location="global", project=project_id)

# 2. OpenAI (Architects & Optimists)
# Using o3-mini as our planning and affirmative synthesis engine
o3_mini = init_chat_model("o3-mini", model_provider="openai")

# 3. Anthropic (Critics & Arbiters)
# Using Claude Sonnet as our rigorous skeptic and balanced judge
claude_sonnet = init_chat_model("claude-sonnet-4-6", model_provider="anthropic")
