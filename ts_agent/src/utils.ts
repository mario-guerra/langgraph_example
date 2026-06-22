import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { OutputParserException } from "@langchain/core/output_parsers";
import { ZodSchema } from "zod";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripNulls(obj: any): any {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const newVal = stripNulls(v);
      if (newVal !== undefined) {
        newObj[k] = newVal;
      }
    }
    return newObj;
  }
  return obj;
}

// Helper to extract tool/schema name from a Zod schema
function getToolName(schema: any): string {
  let s = schema;
  for (let i = 0; i < 5; i++) {
    if (!s || !s._def) break;
    if (s._def.schema) {
      s = s._def.schema;
    } else if (s._def.innerType) {
      s = s._def.innerType;
    } else {
      break;
    }
  }
  if (s && s.shape) {
    const keys = Object.keys(s.shape);
    if (keys.includes("topics")) return "IntentSchema";
    if (keys.includes("resolves_ambiguity")) return "ClarificationSchema";
    if (keys.includes("steps")) return "ResearchPlan";
    if (keys.includes("amended_query")) return "UncertaintyDecision";
    if (keys.includes("coverage_gaps")) return "EvidenceSufficiencyDecision";
    if (keys.includes("claim")) return "DebateArgument";
    if (keys.includes("winning_position")) return "JudgeVerdict";
    if (keys.includes("annotations")) return "CredibilityList";
  }
  return "StructuredOutput";
}

// Function that invokes a model with a structured output wrapper and retries on errors.
export async function invokeStructured<T>(
  modelWithOutput: { invoke: (messages: any) => Promise<T> },
  messages: BaseMessage[],
  schema: ZodSchema<T>,
  maxRetries = 3
): Promise<T> {
  const currentMessages = [...messages];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let result: any = undefined;
    try {
      result = await modelWithOutput.invoke(currentMessages);
      const cleaned = stripNulls(result);
      // Validate schema if model doesn't guarantee strict schema adherence
      return schema.parse(cleaned);
    } catch (e: any) {
      const isValidationError = e.name === "ZodError";
      const isOutputParserError = e instanceof OutputParserException;
      const isMalformedCall = e.message && (
        /malformed function call/i.test(e.message) || 
        /reading 'message'/i.test(e.message) ||
        /reading 'parts'/i.test(e.message)
      );

      if (attempt === maxRetries - 1) {
        throw e;
      }

      if (isValidationError || isOutputParserError || isMalformedCall) {
        // Feed the schema violation back to the model to prompt correction.
        // We must push an AIMessage first so the message roles alternate (User -> Assistant -> User).
        let rawContent = "";
        if (result !== undefined) {
          rawContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        } else if (e.output !== undefined) {
          rawContent = typeof e.output === "string" ? e.output : JSON.stringify(e.output, null, 2);
        }

        const toolName = getToolName(schema);
        if (!rawContent || rawContent.trim() === "") {
          rawContent = `Attempting to call tool ${toolName}...`;
        }

        currentMessages.push(
          new AIMessage({
            content: rawContent,
          })
        );

        let errorMessage = e.message || String(e);
        if (isMalformedCall) {
          errorMessage = `The function call was malformed (possibly wrapped in print() or namespace default_api). You must invoke the '${toolName}' tool directly with correct JSON arguments. Do NOT prepend 'default_api.', do NOT use Python code syntax, and do NOT wrap the call in print().`;
        }

        currentMessages.push(
          new HumanMessage({
            content: `Validation failed: ${errorMessage}\n\nPlease correct the tool call format and try again.`
          })
        );
      } else {
        // Exponential backoff sleep for standard transient connection/network errors
        const backoffMs = Math.pow(2, attempt) * 1000;
        await sleep(backoffMs);
      }
    }
  }
  throw new Error("invokeStructured failed: max retries reached");
}
