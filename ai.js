const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, ".env");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function getAiMode() {
  return getGeminiApiKey() ? "google" : "search";
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildHistoryContents(history = []) {
  return history
    .filter((entry) => entry?.text?.trim())
    .slice(-10)
    .map((entry) => ({
      role: entry.role === "bot" ? "model" : "user",
      parts: [{ text: entry.text.trim() }],
    }));
}

async function askGeminiWithGoogleSearch(message, language = "en", history = []) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const systemInstruction =
    language === "ml"
      ? "You are Lynor, a friendly AI chat companion. Reply in Malayalam when the user writes in Malayalam. Use Google Search for factual, current, and general knowledge questions. Give clear, helpful answers in a warm conversational tone. Keep replies concise unless the user asks for detail."
      : "You are Lynor, a friendly AI chat companion. Use Google Search for factual, current, and general knowledge questions. Give clear, helpful answers in a warm conversational tone. Keep replies concise unless the user asks for detail.";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [...buildHistoryContents(history), { role: "user", parts: [{ text: message }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed (${response.status}).`);
  }

  const reply = extractGeminiText(payload);
  if (!reply) throw new Error("Gemini returned an empty answer.");
  return reply;
}

function cleanSearchQuery(query) {
  let cleaned = query.trim();

  const inventedMatch = cleaned.match(/^who invented (the )?(.+)$/i);
  if (inventedMatch) return `${inventedMatch[2]} inventor`;

  cleaned = cleaned
    .replace(
      /^(what is|what's|who is|who was|who are|when is|when was|where is|where are|how many|how much|tell me about|explain)\s+(the\s+)?/gi,
      ""
    )
    .replace(/\?+$/g, "")
    .trim();

  return cleaned || query.trim();
}

function pickBestAnswer(extract, query) {
  const sentences = extract.match(/[^.!?]+[.!?]+/g) || [extract];
  const cleaned = cleanSearchQuery(query).toLowerCase();

  if (/capital of /i.test(cleaned) || /capital of /i.test(query)) {
    const capitalSentence = sentences.find((sentence) => /capital/i.test(sentence));
    if (capitalSentence) return capitalSentence.trim();
  }

  if (/who invented/i.test(query)) {
    const inventorSentence = sentences.find((sentence) => /invent/i.test(sentence));
    if (inventorSentence) return inventorSentence.trim();
  }

  return summarizeAnswer(extract);
}

function summarizeAnswer(text, maxLength = 420) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const cut = cleaned.slice(0, maxLength);
  const lastPeriod = cut.lastIndexOf(".");
  return lastPeriod > 100 ? cut.slice(0, lastPeriod + 1) : `${cut}...`;
}

function tryMathAnswer(query) {
  let expression = query
    .toLowerCase()
    .replace(/^(what is|what's|calculate|compute|evaluate)\s+/i, "")
    .replace(/\?+$/g, "")
    .replace(/equals?$/i, "")
    .replace(/times|multiplied by/gi, "*")
    .replace(/plus/gi, "+")
    .replace(/minus/gi, "-")
    .replace(/divided by|over/gi, "/")
    .replace(/[x×]/gi, "*")
    .replace(/\s+/g, "");

  if (!expression || !/\d/.test(expression)) return null;
  if (!/^[\d+\-*/().]+$/.test(expression)) return null;

  try {
    const value = Function(`"use strict"; return (${expression})`)();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  } catch {
    return null;
  }

  return null;
}

function isRelevantWikiResult(query, result) {
  if (!result?.title) return false;
  const haystack = `${result.title} ${result.snippet || ""}`.toLowerCase();
  const terms = cleanSearchQuery(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 3);
  if (terms.length === 0) return true;
  return terms.some((term) => haystack.includes(term));
}

async function searchDuckDuckGoInstantAnswer(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const response = await fetch(url, { headers: { "User-Agent": "LynorChatbot/1.0" } });
  if (!response.ok) throw new Error(`Search request failed (${response.status}).`);
  return response.json();
}

function pickRelatedTopic(relatedTopics = []) {
  for (const topic of relatedTopics) {
    if (topic.Text) return topic.Text;
    if (Array.isArray(topic.Topics)) {
      const nested = topic.Topics.find((item) => item.Text);
      if (nested) return nested.Text;
    }
  }
  return "";
}

async function searchDuckDuckGoHtml(query) {
  const queries = [query, cleanSearchQuery(query)].filter((value, index, all) => value && all.indexOf(value) === index);

  for (const searchQuery of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) continue;

    const html = await response.text();
    const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (snippets.length > 0) return summarizeAnswer(snippets[0]);
  }

  return "";
}

function buildWikiQueries(query) {
  const cleaned = cleanSearchQuery(query);
  const queries = [cleaned, query.trim()];

  const capitalMatch = cleaned.match(/^capital of (.+)$/i) || query.match(/capital of (.+?)\??$/i);
  if (capitalMatch) {
    const place = capitalMatch[1].trim();
    queries.unshift(place, `${place} country`);
  }

  const inventorMatch = query.match(/^who invented (?:the )?(.+)$/i);
  if (inventorMatch) queries.unshift(`${inventorMatch[1].trim()} inventor`);

  return [...new Set(queries.filter(Boolean))];
}

function scoreWikiResult(query, result) {
  const cleaned = cleanSearchQuery(query).toLowerCase();
  const title = result.title.toLowerCase();
  const snippet = (result.snippet || "").replace(/<[^>]+>/g, "").toLowerCase();
  let score = 0;

  if (title.startsWith("list of")) score -= 4;
  if (snippet.includes("capital")) score += 2;

  const capitalMatch = cleaned.match(/^capital of (.+)$/);
  if (capitalMatch) {
    const place = capitalMatch[1].toLowerCase();
    if (title === place) score += 12;
    if (snippet.includes(place) && snippet.includes("capital")) score += 6;
  }

  const terms = cleaned.split(/\s+/).filter((term) => term.length > 3);
  for (const term of terms) {
    if (title.includes(term)) score += 2;
    if (snippet.includes(term)) score += 1;
  }

  return score;
}

async function fetchWikiSearchResults(query) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&origin=*`;
  const searchResponse = await fetch(searchUrl, {
    headers: { "User-Agent": "LynorChatbot/1.0" },
  });
  if (!searchResponse.ok) return [];
  const searchData = await searchResponse.json();
  return searchData?.query?.search || [];
}

async function searchWikipedia(query) {
  const queries = buildWikiQueries(query);
  const rankedResults = [];

  for (const wikiQuery of queries) {
    const results = await fetchWikiSearchResults(wikiQuery);
    for (const result of results.slice(0, 5)) {
      rankedResults.push({
        result,
        score: scoreWikiResult(query, result),
      });
    }
  }

  const best = rankedResults
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.result)
    .find((result) => isRelevantWikiResult(query, result));

  if (!best?.title) return "";

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.title.replace(/ /g, "_"))}`;
  const summaryResponse = await fetch(summaryUrl, {
    headers: { "User-Agent": "LynorChatbot/1.0" },
  });
  if (!summaryResponse.ok) return "";

  const summary = await summaryResponse.json();
  return pickBestAnswer(summary.extract || "", query);
}

async function askWebSearchFallback(message, language = "en") {
  const mathAnswer = tryMathAnswer(message);
  if (mathAnswer) return mathAnswer;

  const instant = await searchDuckDuckGoInstantAnswer(message);
  if (instant.AbstractText) {
    const source = instant.AbstractSource ? ` Source: ${instant.AbstractSource}.` : "";
    return `${instant.AbstractText}${source}`;
  }

  const related = pickRelatedTopic(instant.RelatedTopics);
  if (related) return related;

  const htmlAnswer = await searchDuckDuckGoHtml(message);
  if (htmlAnswer) {
    return language === "ml"
      ? `ഇന്റർനെറ്റിൽ നിന്ന് കണ്ടെത്തിയത്: ${htmlAnswer}`
      : htmlAnswer;
  }

  const wikiAnswer = await searchWikipedia(message);
  if (wikiAnswer) {
    return language === "ml" ? `വിക്കിപീഡിയയിൽ നിന്ന്: ${wikiAnswer}` : wikiAnswer;
  }

  return language === "ml"
    ? "ക്ഷമിക്കണം, ഈ ചോദ്യത്തിന് ഉത്തരം കണ്ടെത്താനായില്ല. കൂടുതൽ വ്യക്തമായി ചോദിക്കാമോ?"
    : "Sorry, I could not find a good answer for that. Could you rephrase your question?";
}

async function generateReply(message, language = "en", history = []) {
  const text = String(message || "").trim();
  if (!text) {
    return language === "ml"
      ? "ദയവായി ആദ്യം ഒരു സന്ദേശം ടൈപ്പ് ചെയ്യുക അല്ലെങ്കിൽ പറയുക."
      : "Please type or say something first.";
  }

  if (getGeminiApiKey()) {
    try {
      return await askGeminiWithGoogleSearch(text, language, history);
    } catch (error) {
      console.warn("Gemini search failed, falling back to web search:", error.message);
    }
  }

  return askWebSearchFallback(text, language);
}

module.exports = {
  generateReply,
  getAiMode,
  getGeminiApiKey,
};
