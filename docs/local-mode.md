# Zero-token mode: Sponde on a local model

TrueForge accepts any OpenAI-compatible endpoint as a custom provider — which
means the entire negotiation can run on a model hosted on your own machine,
with **zero API tokens spent**. On hardware like an NVIDIA DGX Spark, both
agents would live fully on-device.

## Setup (one time, ~5 minutes)

```bash
brew install ollama          # or https://ollama.com/download
ollama pull qwen3:4b         # small enough for a laptop; bigger box, bigger model
ollama serve                 # OpenAI-compatible API on http://localhost:11434/v1
```

In TrueForge → **Settings → Models → Add Custom Provider**:

- Name: `local`
- Base URL: `http://localhost:11434/v1`
- API key: anything non-empty (Ollama ignores it)
- Model: `qwen3:4b`

Then reseed the agents against it:

```bash
MODEL_FQN=local/qwen3:4b npm run seed-agents
npm run doctor
npm run negotiate -- "book dinner for Abhinav and Priya this weekend"
```

## Honest expectations

Small local models negotiate less crisply than frontier ones — they may need
extra nudges to follow the exact-terms commit protocol, and the room's strict
schema will reject their malformed offers rather than forgive them (which is
the protocol working, not failing). The dual human approval gates, privacy
schema, sealing, and calendar hold are identical in both modes: **the trust
model doesn't depend on whose model is talking.** That is rather the point.

Switching back: `MODEL_FQN=openai/gpt-5-6-sol npm run seed-agents`.
