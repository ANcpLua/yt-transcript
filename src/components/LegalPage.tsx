import React from "react";

interface LegalSection {
    title: string;
    body: string;
}

const sections: LegalSection[] = [
    {
        title: "How It Works",
        body: "This tool extracts publicly available transcript data from YouTube videos. All processing happens in your browser.",
    },
    {
        title: "No Server-Side Storage",
        body: "We do not store any data on our servers. Your transcripts, API keys, and preferences are stored locally in your browser using chrome.storage and IndexedDB.",
    },
    {
        title: "Third-Party Services",
        body: "When you use AI features, your transcript data is sent directly from your browser to the AI provider (OpenAI, Anthropic, or Google) using your own API key. We never see or proxy your API key or AI requests.",
    },
    {
        title: "YouTube Disclaimer",
        body: "This tool is not affiliated with, endorsed by, or sponsored by YouTube or Google. Transcripts are extracted from YouTube\u2019s publicly accessible data. Use this tool in accordance with YouTube\u2019s Terms of Service.",
    },
    {
        title: "Data You Control",
        body: "You can export or delete all locally stored data at any time from Settings. Clearing your browser data will remove everything.",
    },
    {
        title: "GDPR",
        body: "No personal data is collected or processed by our servers. All data remains in your browser. There is nothing for us to delete because we never had it.",
    },
    {
        title: "No Cookies or Tracking",
        body: "This tool uses zero cookies, zero analytics, and zero tracking scripts. Check your browser\u2019s network tab to verify.",
    },
    {
        title: "Open Source",
        body: "This tool is provided as-is, without warranty of any kind, express or implied. Use it at your own risk. No guarantee is made regarding availability, accuracy, or fitness for a particular purpose.",
    },
];

export function LegalPage({onBack}: { onBack: () => void }): React.JSX.Element {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <button
                onClick={onBack}
                className="mb-6 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
                </svg>
                Back
            </button>

            <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
                Legal & Privacy
            </h1>
            <p className="mb-8 text-sm text-slate-500 dark:text-slate-400">
                How this tool handles your data.
            </p>

            <div className="space-y-6">
                {sections.map((section) => (
                    <section key={section.title}>
                        <h2 className="mb-1.5 text-base font-semibold text-slate-800 dark:text-slate-200">
                            {section.title}
                        </h2>
                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                            {section.body}
                        </p>
                    </section>
                ))}
            </div>
        </div>
    );
}
