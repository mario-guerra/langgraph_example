"""
DEPRECATED: This file has been refactored into a proper multi-agent architecture.

Please use the new modular structure:
- main.py: Main application entry point
- config.py: Configuration and API key setup  
- state.py: State management
- tools.py: Search tools (weather, news, location)
- agents.py: Agent implementations
- graph.py: Graph orchestration

To run the improved application:
    python main.py

The new architecture includes:
✅ Proper state management
✅ Conditional routing 
✅ Better error handling
✅ Modular design
✅ Type safety
✅ LLM integration for better responses
✅ Enhanced search capabilities
"""

if __name__ == "__main__":
    print(__doc__)
    print("\nRunning the new main.py application...")
    import subprocess
    import sys
    subprocess.run([sys.executable, "main.py"])