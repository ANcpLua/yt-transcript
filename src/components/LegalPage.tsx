import React from "react";

interface LegalSection {
    title: string;
    body: string;
}

const sections: LegalSection[] = [
    {
        title: "How It Works",
        body: "This tool extracts publicly available transcript data from video pages you visit, and can transcribe local video/audio files with on-device AI. All processing happens in your browser.",
    },
    {
        title: "No Server-Side Storage",
        body: "We do not store any data on our servers. Your transcripts and preferences are stored locally in your browser using chrome.storage and IndexedDB.",
    },
    {
        title: "Third-Party Services",
        body: "AI features use Chrome built-in AI in the browser. We never see or proxy AI requests.",
    },
    {
        title: "Trademarks & Affiliation",
        body: "This is an independent tool. It is not affiliated with, endorsed by, or sponsored by any video platform. All product names and trademarks are the property of their respective owners. Use this tool in accordance with each platform\u2019s Terms of Service.",
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
                className="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
                </svg>
                Back
            </button>

            <h1 className="mb-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Legal & Privacy
            </h1>
            <p className="mb-10 text-sm text-slate-500 dark:text-slate-400">
                How this tool handles your data.
            </p>

            <div className="space-y-7">
                {sections.map((section) => (
                    <section key={section.title}>
                        <h2 className="mb-1.5 text-sm font-medium text-slate-900 dark:text-white">
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
