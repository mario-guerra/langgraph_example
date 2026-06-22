import dotenv from "dotenv";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";

dotenv.config();

console.log("GOOGLE_CLOUD_PROJECT from process.env:", process.env.GOOGLE_CLOUD_PROJECT);

// Dummy keys if not present in the environment
const keys = ["GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
for (const key of keys) {
  if (!process.env[key]) {
    process.env[key] = `DUMMY_${key}`;
  }
}

// 1. Google Gemini 2.5 Flash (Vertex AI mode)
export const geminiFlash = new ChatVertexAI({
  model: "gemini-2.5-flash",
  location: "global",
  apiVersion: "v1beta1",
  endpoint: "aiplatform.googleapis.com",
});

// 2. OpenAI o3-mini (Planning / synthesis)
// Critical Defect #4 Fix: temperature is set to undefined for reasoning models (o3-mini)
export const o3Mini = new ChatOpenAI({
  modelName: "o3-mini",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: undefined,
});

// 3. Anthropic Claude 3.5 Sonnet
export const claudeSonnet = new ChatAnthropic({
  modelName: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
claudeSonnet.topP = undefined;
