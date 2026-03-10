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

export function getProvider(
    name: string,
    apiKey: string,
): AiProvider {
    switch (name) {
        case "openai":
            return createOpenAiProvider(apiKey);
        case "anthropic":
            return createAnthropicProvider(apiKey);
        case "google":
            return createGoogleProvider(apiKey);
        default:
            throw new Error(`Unknown AI provider: ${name}`);
    }
}
