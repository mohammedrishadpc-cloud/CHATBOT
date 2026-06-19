# CHATBOT

Lynor AI chat companion with Google Search answers, voice input, and conversation logging.

**Repository:** https://github.com/mohammedrishadpc-cloud/CHATBOT

## Features

- Google Search answers via Gemini
- Text and voice chat
- English / Malayalam support
- Delete recent messages
- Avatar hover animations
- Conversation log

## Run locally

```bash
cd chatbot
cp .env.example .env
# Add your GEMINI_API_KEY to .env
node server.js
```

Open http://localhost:5345

Get a free API key at https://aistudio.google.com/apikey

## Deploy (Render)

1. Connect this repo on [Render](https://render.com)
2. Use the included `render.yaml` blueprint
3. Set `GEMINI_API_KEY` in environment variables
4. Your live URL will be like `https://chatbot.onrender.com`

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Gemini API key for Google Search |
| `GEMINI_MODEL` | No | Default: `gemini-2.5-flash` |
| `PORT` | No | Set automatically by hosting platform |
