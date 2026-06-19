const appShell = document.querySelector(".app-shell");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const messages = document.querySelector("#messages");
const micButton = document.querySelector("#micButton");
const speakToggle = document.querySelector("#speakToggle");
const petAvatar = document.querySelector("#petAvatar");
const statePill = document.querySelector("#statePill");
const recentList = document.querySelector("#recentList");
const clearChatButton = document.querySelector("#clearChat");
const languageToggle = document.querySelector("#languageToggle");
const englishLabel = document.querySelector("#englishLabel");
const malayalamLabel = document.querySelector("#malayalamLabel");
const voiceWarning = document.querySelector("#voiceWarning");
const listeningDots = document.querySelector("#listeningDots");
const accentViolet = document.querySelector("#accentViolet");
const accentCyan = document.querySelector("#accentCyan");
const startState = document.querySelector("#startState");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const stateColors = {
  idle: "#c77dff",
  listening: "#22c55e",
  thinking: "#f59e0b",
  speaking: "#00f5ff",
  happy: "#ff6b9d",
  error: "#f87171",
};

let recognition = null;
let speechEnabled = true;
let isListening = false;
let language = "en";
let chatMessages = [];
let messageIdCounter = 0;

function createMessageId() {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}`;
}

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function setBabluState(state) {
  const label = state.toUpperCase();
  const color = stateColors[state] || stateColors.idle;
  statePill.querySelector("strong").textContent = label;
  statePill.querySelector("strong").style.color = color;
  statePill.querySelector("span").style.background = color;
  statePill.querySelector("span").style.boxShadow = `0 0 10px ${color}`;
  statePill.style.borderColor = `${color}66`;
  statePill.style.background = `${color}18`;
  petAvatar.className = `pet-avatar ${state}`;
}

function updateRecentList() {
  const userMessages = chatMessages
    .filter((message) => message.role === "user")
    .slice(-8)
    .reverse();

  if (userMessages.length === 0) {
    recentList.innerHTML = `<p class="empty-recent">No messages yet.</p>`;
    return;
  }

  recentList.innerHTML = userMessages
    .map((message) => `
      <article class="recent-item" title="${escapeHtml(message.text)}">
        <div class="recent-item-head">
          <small>${message.time}</small>
          <button
            class="recent-delete"
            type="button"
            data-id="${message.id}"
            aria-label="Delete message"
            title="Delete message"
          >🗑️</button>
        </div>
        <p>${escapeHtml(message.text)}</p>
      </article>
    `)
    .join("");
}

function deleteRecentMessage(messageId) {
  const index = chatMessages.findIndex((message) => message.id === messageId);
  if (index === -1) return;

  const idsToRemove = new Set([messageId]);
  if (chatMessages[index].role === "user" && chatMessages[index + 1]?.role === "bot") {
    idsToRemove.add(chatMessages[index + 1].id);
  }

  chatMessages = chatMessages.filter((message) => !idsToRemove.has(message.id));

  idsToRemove.forEach((id) => {
    messages.querySelector(`[data-message-id="${id}"]`)?.remove();
  });

  if (chatMessages.length === 0) startState.style.display = "";
  updateRecentList();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addMessage(role, text, options = {}) {
  startState.style.display = "none";

  const time = options.time || nowTime();
  const id = options.id || createMessageId();
  chatMessages.push({ id, role, text, time });
  updateRecentList();

  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.dataset.messageId = id;
  article.innerHTML = `
    <div class="avatar-mini">${role === "user" ? "U" : "B"}</div>
    <div class="bubble">
      ${escapeHtml(text)}
      <span class="time-tag">${time}</span>
    </div>
  `;
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.id = "typingIndicator";
  typing.innerHTML = `
    <div class="avatar-mini">B</div>
    <div class="typing-bubble"><span></span><span></span><span></span></div>
  `;
  messages.append(typing);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  document.querySelector("#typingIndicator")?.remove();
}

function speak(text) {
  if (!speechEnabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "ml" ? "ml-IN" : "en-IN";
  utterance.rate = 1;
  utterance.pitch = 1.08;
  utterance.onstart = () => setBabluState("speaking");
  utterance.onend = () => setBabluState("idle");
  utterance.onerror = () => setBabluState("idle");
  window.speechSynthesis.speak(utterance);
}

function canUseServerApi() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

async function requestBotReply(message, inputType) {
  if (!canUseServerApi()) {
    return {
      reply:
        language === "ml"
          ? "ഇന്റർനെറ്റിൽ നിന്ന് ഉത്തരം ലഭിക്കാൻ സെർവർ റൺ ചെയ്യണം. ടെർമിനലിൽ `node server.js` റൺ ചെയ്ത് http://localhost:5345 തുറക്കുക."
          : "To answer questions from the web, run the server first. In a terminal: `node server.js`, then open http://localhost:5345.",
      timestamp: nowTime(),
      offline: true,
    };
  }

  const history = chatMessages
    .slice(0, -1)
    .slice(-10)
    .map((entry) => ({ role: entry.role, text: entry.text }));

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, inputType, language, history }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The server could not reply.");
  return payload;
}

function deliverBotReply(reply) {
  hideTyping();
  addMessage("bot", reply);
  setBabluState("happy");
  window.setTimeout(() => speak(reply), 180);
  if (!speechEnabled) window.setTimeout(() => setBabluState("idle"), 1200);
}

async function sendMessage(message, inputType = "text") {
  const cleanMessage = message.trim();
  if (!cleanMessage) return;

  addMessage("user", cleanMessage);
  console.log(`[User ${inputType}] ${cleanMessage}`);
  input.value = "";
  setBabluState("thinking");
  showTyping();

  try {
    const payload = await requestBotReply(cleanMessage, inputType);
    console.log(`[Bot ${payload.timestamp}] ${payload.reply}`);
    deliverBotReply(payload.reply);
  } catch (error) {
    console.warn("Server chat failed.", error);
    hideTyping();
    const fallback =
      language === "ml"
        ? `ക്ഷമിക്കണം, ഉത്തരം ലഭിച്ചില്ല. (${error.message})`
        : `Sorry, I could not get an answer. (${error.message})`;
    addMessage("bot", fallback);
    speak(fallback);
    setBabluState("error");
    window.setTimeout(() => setBabluState("idle"), 1800);
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    micButton.disabled = true;
    micButton.title = "Speech recognition is not supported in this browser";
    voiceWarning.classList.add("visible");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = language === "ml" ? "ml-IN" : "en-US";

  recognition.onstart = () => {
    isListening = true;
    micButton.classList.add("listening");
    input.classList.add("listening");
    listeningDots.classList.add("active");
    micButton.title = "Stop voice input";
    setBabluState("listening");
  };

  recognition.onend = () => {
    isListening = false;
    micButton.classList.remove("listening");
    input.classList.remove("listening");
    listeningDots.classList.remove("active");
    micButton.title = "Start voice input";
    if (petAvatar.classList.contains("listening")) setBabluState("idle");
  };

  recognition.onerror = (event) => {
    const message = event.error === "not-allowed"
      ? "Microphone permission was blocked."
      : `Voice input error: ${event.error}`;
    addMessage("bot", message);
    speak(message);
    setBabluState("error");
  };

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interim += transcript;
    }
    input.value = finalText || interim;
    if (finalText.trim()) sendMessage(finalText, "voice");
  };
}

function updateLanguageUI() {
  if (language === "en") {
    englishLabel.classList.add("selected");
    malayalamLabel.classList.remove("selected");
    input.placeholder = "Talk to Lynor...";
  } else {
    malayalamLabel.classList.add("selected");
    englishLabel.classList.remove("selected");
    input.placeholder = "ബബ്ലുവിനോട് സംസാരിക്കൂ...";
  }

  if (recognition) recognition.lang = language === "ml" ? "ml-IN" : "en-US";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value, "text");
});

micButton.addEventListener("click", () => {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    return;
  }
  recognition.lang = language === "ml" ? "ml-IN" : "en-US";
  recognition.start();
});

speakToggle.addEventListener("click", () => {
  speechEnabled = !speechEnabled;
  speakToggle.textContent = speechEnabled ? "🔊" : "🔇";
  speakToggle.title = speechEnabled ? "Speech on" : "Speech off";
  speakToggle.setAttribute("aria-pressed", String(speechEnabled));
  if (!speechEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    setBabluState("idle");
  }
});

clearChatButton.addEventListener("click", () => {
  chatMessages = [];
  messages.querySelectorAll(".message, .typing").forEach((node) => node.remove());
  startState.style.display = "";
  updateRecentList();
  setBabluState("idle");
});

recentList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".recent-delete");
  if (!deleteButton) return;
  event.stopPropagation();
  deleteRecentMessage(deleteButton.dataset.id);
});

languageToggle.addEventListener("click", () => {
  language = language === "en" ? "ml" : "en";
  updateLanguageUI();
});

accentViolet.addEventListener("click", () => {
  appShell.dataset.accent = "violet";
  accentViolet.classList.add("active");
  accentCyan.classList.remove("active");
});

accentCyan.addEventListener("click", () => {
  appShell.dataset.accent = "cyan";
  accentCyan.classList.add("active");
  accentViolet.classList.remove("active");
});

setupSpeechRecognition();
updateLanguageUI();
setBabluState("idle");

if (!canUseServerApi()) {
  document.querySelectorAll('a[href="/api/log"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      addMessage("bot", "Conversation logs are available when you run the app with `node server.js` and open http://localhost:5345.");
    });
  });
}
