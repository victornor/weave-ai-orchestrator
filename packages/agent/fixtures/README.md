Stream fixtures for the codec tests.

`real-*` are raw captures the weaver recorded against live endpoints on 2026-09-20 (VS-605 probes), byte for byte, with no account ids in them:

| File | Endpoint | Model asked / served | Probe |
|---|---|---|---|
| `real-cheaper-deepseek-tool.sse` | cheaper-inference | deepseek-v4.1-flash | 5.4 streamed tool call |
| `real-cheaper-deepseek-usage.sse` | cheaper-inference | deepseek-v4.1-flash | 5.3 streamed usage |
| `real-cheaper-gpt-tool.sse` | cheaper-inference | gpt-5.6-luna | 5.4 |
| `real-cheaper-gpt-usage.sse` | cheaper-inference | gpt-5.6-luna | 5.3 |
| `real-zai-tool.sse` | Z.ai coding plan | glm-4.5-air, served as glm-5.3-flash | 5.4 |
| `real-zai-usage.sse` | Z.ai coding plan | glm-4.5-air, served as glm-5.3-flash | 5.3 |
| `real-openrouter-tool.sse` | OpenRouter | z-ai/glm-5.3-flashx | 5.4 |
| `deepseek-402-insufficient-balance.json` | DeepSeek direct | deepseek-flash | every call: HTTP 402 body |

`mock-*` are hand-written. Flags in `packages/agent/presets` that these captures prove name the file in their `verified` entry.
