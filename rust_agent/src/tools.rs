use anyhow::{Result, Context};
use reqwest::Client;
use serde_json::Value;

pub async fn weather_search(query: &str, location: &str, api_key: &str) -> Result<String> {
    let client = Client::new();
    let search_query = if location.is_empty() {
        format!("{} weather", query)
    } else {
        format!("{} weather {}", location, query)
    };

    let res: Value = client.get("https://serpapi.com/search")
        .query(&[
            ("q", search_query.as_str()),
            ("api_key", api_key),
            ("hl", "en"),
            ("location", if location.is_empty() { "United States" } else { location })
        ])
        .send()
        .await
        .context("Failed to send SerpAPI request")?
        .json()
        .await
        .context("Failed to parse JSON response")?;

    if let Some(weather) = res.get("weather_result") {
        let loc_name = weather.get("location").and_then(|v| v.as_str()).unwrap_or(location);
        let temp = weather.get("temperature").and_then(|v| v.as_str()).unwrap_or("N/A");
        let cond = weather.get("weather").and_then(|v| v.as_str()).unwrap_or("N/A");
        return Ok(format!("Current weather in {}: {}, {}", loc_name, temp, cond));
    }

    if let Some(organic) = res.get("organic_results").and_then(|v| v.as_array()) {
        if let Some(first) = organic.first() {
            let title = first.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let snippet = first.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
            return Ok(format!("Weather for {}: {}\n{}", location, title, snippet));
        }
    }

    Ok(format!("No weather information found for {}", location))
}

pub async fn news_search(query: &str, location: &str, api_key: &str) -> Result<String> {
    let client = Client::new();
    let search_query = if location.is_empty() {
        format!("{} news", query)
    } else {
        format!("{} news {}", location, query)
    };

    let res: Value = client.get("https://serpapi.com/search")
        .query(&[
            ("q", search_query.as_str()),
            ("api_key", api_key),
            ("hl", "en"),
            ("tbm", "nws"),
            ("num", "3")
        ])
        .send()
        .await
        .context("Failed to send SerpAPI request")?
        .json()
        .await
        .context("Failed to parse JSON response")?;

    if let Some(news) = res.get("news_results").and_then(|v| v.as_array()) {
        if !news.is_empty() {
            let mut items = Vec::new();
            for item in news.iter().take(3) {
                let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let snippet = item.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
                let source = item.get("source").and_then(|v| v.as_str()).unwrap_or("");
                items.push(format!("• {} ({})\n  {}", title, source, snippet));
            }
            return Ok(format!("Recent news for {}:\n\n{}", location, items.join("\n\n")));
        }
    }

    Ok(format!("No recent news found for {}", location))
}

pub async fn web_search(query: &str, location: &str, api_key: &str) -> Result<String> {
    let client = Client::new();
    let search_query = if location.is_empty() {
        query.to_string()
    } else {
        format!("{} {}", location, query)
    };

    let res: Value = client.get("https://serpapi.com/search")
        .query(&[
            ("q", search_query.as_str()),
            ("api_key", api_key),
            ("hl", "en"),
            ("num", "5")
        ])
        .send()
        .await
        .context("Failed to send SerpAPI request")?
        .json()
        .await
        .context("Failed to parse JSON response")?;

    if let Some(organic) = res.get("organic_results").and_then(|v| v.as_array()) {
        if !organic.is_empty() {
            let mut items = Vec::new();
            for item in organic.iter().take(4) {
                let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let snippet = item.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
                let link = item.get("displayed_link").and_then(|v| v.as_str()).unwrap_or("");
                items.push(format!("• [{}] {}\n  {}", link, title, snippet));
            }
            return Ok(items.join("\n\n"));
        }
    }

    Ok(format!("No results found for: {}", search_query))
}

pub fn resolve_location(location: &str) -> String {
    let loc = location.trim();
    match loc.to_lowercase().as_str() {
        "nyc" => "New York, NY".to_string(),
        "la" => "Los Angeles, CA".to_string(),
        "sf" => "San Francisco, CA".to_string(),
        "chi" => "Chicago, IL".to_string(),
        _ => loc.to_string(),
    }
}
