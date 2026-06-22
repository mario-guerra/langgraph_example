import { tool } from "@langchain/core/tools";
import { getJson } from "serpapi";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

function getApiKey() {
  return process.env.SERPAPI_API_KEY;
}

export const weather_search = tool(
  async ({ query, location = "" }) => {
    const api_key = getApiKey();
    if (!api_key) {
      return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file.";
    }

    const searchQuery = location ? `${location} weather ${query}` : `${query} weather`;
    const params = {
      q: searchQuery,
      api_key,
      hl: "en",
      location: location ? location : "United States",
    };

    try {
      // Direct search call to serpapi package
      const results = await getJson({ ...params, engine: "google" });

      // Look for weather box first (more accurate)
      if ("weather_result" in results && results.weather_result) {
        const weather = results.weather_result as Record<string, any>;
        const locationName = weather.location || location;
        const temp = weather.temperature || "N/A";
        const condition = weather.weather || "N/A";
        return `Current weather in ${locationName}: ${temp}, ${condition}`;
      }

      // Fallback to organic results
      if ("organic_results" in results && Array.isArray(results.organic_results) && results.organic_results.length > 0) {
        const first = results.organic_results[0];
        const title = first.title || "";
        const snippet = first.snippet || "";
        return `Weather for ${location}: ${title}\n${snippet}`;
      }

      return `No weather information found for ${location}`;
    } catch (e: any) {
      return `Error fetching weather data: ${e.message || String(e)}`;
    }
  },
  {
    name: "weather_search",
    description: "Search for current weather information for a specific location.",
    schema: z.object({
      query: z.string().describe("The search query terms."),
      location: z.string().optional().default("").describe("Target location."),
    }),
  }
);

export const news_search = tool(
  async ({ query, location = "" }) => {
    const api_key = getApiKey();
    if (!api_key) {
      return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file.";
    }

    const searchQuery = location ? `${location} news ${query}` : `${query} news`;
    const params = {
      q: searchQuery,
      api_key,
      hl: "en",
      tbm: "nws", // News search
      num: 3,
    };

    try {
      const results = await getJson({ ...params, engine: "google" });

      if ("news_results" in results && Array.isArray(results.news_results) && results.news_results.length > 0) {
        const newsItems = results.news_results.slice(0, 3).map((item: any) => {
          const title = item.title || "";
          const snippet = item.snippet || "";
          const source = item.source || "";
          return `• ${title} (${source})\n  ${snippet}`;
        });
        return `Recent news for ${location}:\n\n` + newsItems.join("\n\n");
      }

      // Fallback to organic results
      if ("organic_results" in results && Array.isArray(results.organic_results) && results.organic_results.length > 0) {
        const newsItems = results.organic_results.slice(0, 3).map((item: any) => {
          const title = item.title || "";
          const snippet = item.snippet || "";
          return `• ${title}\n  ${snippet}`;
        });
        return `News for ${location}:\n\n` + newsItems.join("\n\n");
      }

      return `No recent news found for ${location}`;
    } catch (e: any) {
      return `Error fetching news data: ${e.message || String(e)}`;
    }
  },
  {
    name: "news_search",
    description: "Search for recent news related to a location or topic.",
    schema: z.object({
      query: z.string().describe("The search query terms."),
      location: z.string().optional().default("").describe("Target location."),
    }),
  }
);

export const resolve_location = tool(
  async ({ location }) => {
    const cleaned = location.trim().replace(/\w\S*/g, (txt) => {
      return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
    });

    const locationMappings: Record<string, string> = {
      Nyc: "New York, NY",
      La: "Los Angeles, CA",
      Sf: "San Francisco, CA",
      Chi: "Chicago, IL",
    };

    return locationMappings[cleaned] || cleaned;
  },
  {
    name: "resolve_location",
    description: "Resolve and validate location names.",
    schema: z.object({
      location: z.string().describe("The location string to validate and resolve."),
    }),
  }
);

export const web_search = tool(
  async ({ query, location = "" }) => {
    const api_key = getApiKey();
    if (!api_key) {
      return "SerpAPI key not found. Please set SERPAPI_API_KEY in your .env file.";
    }

    const searchQuery = location ? `${location} ${query}`.trim() : query;
    const params = {
      q: searchQuery,
      api_key,
      hl: "en",
      num: 5,
    };

    try {
      const results = await getJson({ ...params, engine: "google" });

      if ("organic_results" in results && Array.isArray(results.organic_results) && results.organic_results.length > 0) {
        const items = results.organic_results.slice(0, 4).map((item: any) => {
          const title = item.title || "";
          const snippet = item.snippet || "";
          const source = item.displayed_link || "";
          return `• [${source}] ${title}\n  ${snippet}`;
        });
        return items.join("\n\n");
      }
      return `No results found for: ${searchQuery}`;
    } catch (e: any) {
      return `Error: ${e.message || String(e)}`;
    }
  },
  {
    name: "web_search",
    description: "General-purpose web search for topics beyond weather and news.",
    schema: z.object({
      query: z.string().describe("Search query terms."),
      location: z.string().optional().default("").describe("Target location."),
    }),
  }
);

export const toolRegistry: Record<string, any> = {
  weather_search,
  news_search,
  resolve_location,
  web_search,
};
