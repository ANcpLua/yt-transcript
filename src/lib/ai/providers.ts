import { isChromeAiPromptAvailable, runChromeAiPrompt } from "./chrome-ai";

export interface AiProvider {
    name: string;

    sendMessage(params: {
        systemPrompt: string;
        userMessage: string;
        maxTokens?: number;
    }): Promise<string>;

    validateKey(): Promise<boolean>;
}

class AiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly provider: string,
    ) {
        super(message);
        this.name = "AiError";
    }
}

function handleErrorStatus(status: number, provider: string): never {
    switch (true) {
        case status === 401 || status === 403:
            throw new AiError(
                `Invalid API key for ${provider}. Please check your key in Settings.`,
                status,
                provider,
            );
        case status === 429:
            throw new AiError(
                `Rate limit exceeded for ${provider}. Please wait a moment and try again.`,
                status,
                provider,
            );
        case status >= 500:
            throw new AiError(
                `${provider} server error (${status}). Please try again later.`,
                status,
                provider,
            );
        default:
            throw new AiError(
                `${provider} request failed with status ${status}.`,
                status,
                provider,
            );
    }
}

function createOpenAiProvider(apiKey: string): AiProvider {
    const BASE_URL = "https://api.openai.com/v1";
    const MODEL = "gpt-4o-mini";

    async function request(
        body: Record<string, unknown>,
    ): Promise<Response> {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            handleErrorStatus(response.status, "OpenAI");
        }

        return response;
    }

    return {
        name: "openai",

        async sendMessage({systemPrompt, userMessage, maxTokens = 4096}) {
            const response = await request({
                model: MODEL,
                messages: [
                    {role: "system", content: systemPrompt},
                    {role: "user", content: userMessage},
                ],
                max_tokens: maxTokens,
            });

            const data: {
                choices: { message: { content: string | null } }[];
            } = await response.json();

            const content = data.choices[0]?.message.content;
            if (content === null || content === undefined) {
                throw new AiError("OpenAI returned empty response.", 0, "OpenAI");
            }
            return content;
        },

        async validateKey() {
            try {
                const response = await fetch(`${BASE_URL}/models`, {
                    headers: {Authorization: `Bearer ${apiKey}`},
                });
                return response.ok;
            } catch {
                return false;
            }
        },
    };
}

function createAnthropicProvider(apiKey: string): AiProvider {
    const BASE_URL = "https://api.anthropic.com/v1";
    const MODEL = "claude-haiku-4-5-20251001";

    async function request(
        body: Record<string, unknown>,
    ): Promise<Response> {
        const response = await fetch(`${BASE_URL}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            handleErrorStatus(response.status, "Anthropic");
        }

        return response;
    }

    return {
        name: "anthropic",

        async sendMessage({systemPrompt, userMessage, maxTokens = 4096}) {
            const response = await request({
                model: MODEL,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{role: "user", content: userMessage}],
            });

            const data: {
                content: { type: string; text: string }[];
            } = await response.json();

            const textBlock = data.content.find((b) => b.type === "text");
            if (!textBlock) {
                throw new AiError(
                    "Anthropic returned empty response.",
                    0,
                    "Anthropic",
                );
            }
            return textBlock.text;
        },

        async validateKey() {
            try {
                const response = await request({
                    model: MODEL,
                    max_tokens: 1,
                    messages: [{role: "user", content: "Hi"}],
                });
                return response.ok || response.status === 200;
            } catch (err) {
                if (err instanceof AiError && (err.status === 401 || err.status === 403)) {
                    return false;
                }
                if (err instanceof AiError && err.status === 429) {
                    return true; // Key is valid, just rate limited
                }
                return false;
            }
        },
    };
}

function createGoogleProvider(apiKey: string): AiProvider {
    const MODEL = "gemini-2.0-flash";
    const BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

    async function request(
        body: Record<string, unknown>,
    ): Promise<Response> {
        const response = await fetch(
            `${BASE_URL}:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body),
            },
        );

        if (!response.ok) {
            handleErrorStatus(response.status, "Google Gemini");
        }

        return response;
    }

    return {
        name: "google",

        async sendMessage({systemPrompt, userMessage, maxTokens = 4096}) {
            const response = await request({
                systemInstruction: {
                    parts: [{text: systemPrompt}],
                },
                contents: [
                    {
                        role: "user",
                        parts: [{text: userMessage}],
                    },
                ],
                generationConfig: {
                    maxOutputTokens: maxTokens,
                },
            });

            const data: {
                candidates: {
                    content: { parts: { text: string }[] };
                }[];
            } = await response.json();

            const text = data.candidates[0]?.content.parts[0]?.text;
            if (text === undefined) {
                throw new AiError(
                    "Google Gemini returned empty response.",
                    0,
                    "Google Gemini",
                );
            }
            return text;
        },

        async validateKey() {
            try {
                const response = await fetch(
                    `${BASE_URL}:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({
                            contents: [
                                {role: "user", parts: [{text: "Hi"}]},
                            ],
                            generationConfig: {maxOutputTokens: 1},
                        }),
                    },
                );
                return response.ok;
            } catch {
                return false;
            }
        },
    };
}

export interface OllamaConfig {
    url: string;
    model: string;
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";

function createChromeAiProvider(): AiProvider {
    return {
        name: "chrome-ai",

        async sendMessage({ systemPrompt, userMessage }) {
            try {
                return await runChromeAiPrompt(systemPrompt, userMessage);
            } catch (e) {
                // Surface as a structured AiError so the SW handler /
                // AiPanel error UI gets a provider tag and the existing
                // status-based switch behaves consistently with the
                // remote providers below. Chrome AI failures are not
                // HTTP-shaped, so `status: 0` marks "non-HTTP".
                throw new AiError(
                    e instanceof Error ? e.message : String(e),
                    0,
                    "Chrome AI",
                );
            }
        },

        async validateKey() {
            return isChromeAiPromptAvailable();
        },
    };
}

function createOllamaProvider(config: OllamaConfig): AiProvider {
    const baseUrl = config.url.replace(/\/$/, "");

    return {
        name: "ollama",

        async sendMessage({ systemPrompt, userMessage }) {
            let response: Response;
            try {
                response = await fetch(`${baseUrl}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userMessage },
                        ],
                        stream: false,
                    }),
                });
            } catch {
                throw new AiError(
                    `Could not reach Ollama at ${baseUrl}. Make sure Ollama is running ('ollama serve') and the model '${config.model}' is pulled ('ollama pull ${config.model}').`,
                    0,
                    "Ollama",
                );
            }

            if (!response.ok) {
                if (response.status === 404) {
                    throw new AiError(
                        `Model '${config.model}' is not available in Ollama. Run 'ollama pull ${config.model}'.`,
                        404,
                        "Ollama",
                    );
                }
                handleErrorStatus(response.status, "Ollama");
            }

            const data: { message?: { content?: string } } = await response.json();
            const content = data.message?.content;
            if (!content) {
                throw new AiError("Ollama returned an empty response.", 0, "Ollama");
            }
            return content;
        },

        async validateKey() {
            try {
                const response = await fetch(`${baseUrl}/api/tags`);
                return response.ok;
            } catch {
                return false;
            }
        },
    };
}

export function getProvider(
    name: string,
    apiKeyOrConfig: string | OllamaConfig,
): AiProvider {
    switch (name) {
        case "chrome-ai":
            return createChromeAiProvider();
        case "ollama":
            if (typeof apiKeyOrConfig === "string") {
                return createOllamaProvider({ url: DEFAULT_OLLAMA_URL, model: apiKeyOrConfig || DEFAULT_OLLAMA_MODEL });
            }
            return createOllamaProvider(apiKeyOrConfig);
        case "openai":
            return createOpenAiProvider(typeof apiKeyOrConfig === "string" ? apiKeyOrConfig : "");
        case "anthropic":
            return createAnthropicProvider(typeof apiKeyOrConfig === "string" ? apiKeyOrConfig : "");
        case "google":
            return createGoogleProvider(typeof apiKeyOrConfig === "string" ? apiKeyOrConfig : "");
        default:
            throw new Error(`Unknown AI provider: ${name}`);
    }
}
