"""Utility functions for the multi-agent system."""
import time
from typing import TypeVar, Type
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from pydantic import ValidationError
from langchain_core.exceptions import OutputParserException

T = TypeVar("T", bound=BaseModel)

def invoke_structured(model_with_output, messages: list, schema: Type[T], max_retries=3) -> T:
    """Invoke an LLM with structured output, retrying on validation errors."""
    current_messages = list(messages)
    for attempt in range(max_retries):
        try:
            return model_with_output.invoke(current_messages)
        except (ValidationError, OutputParserException) as e:
            if attempt == max_retries - 1:
                raise
            
            # Feed the error back to the LLM so it can correct the mistake
            current_messages.append(HumanMessage(
                content=f"Validation failed: {str(e)}\n\nPlease fix the format and try again."
            ))
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
