import {type KeyboardEvent, useCallback, useState} from "react";

interface TagEditorProps {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
}

export function TagEditor({tags, onTagsChange}: TagEditorProps): React.JSX.Element {
    const [input, setInput] = useState("");

    const addTags = useCallback((raw: string) => {
        const newTags = raw
            .split(",")
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0 && !tags.includes(t));
        if (newTags.length > 0) {
            onTagsChange([...tags, ...newTags]);
        }
        setInput("");
    }, [tags, onTagsChange]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (input.trim()) addTags(input);
        }
        if (e.key === "Backspace" && input === "" && tags.length > 0) {
            onTagsChange(tags.slice(0, -1));
        }
    }, [input, tags, addTags, onTagsChange]);

    const removeTag = useCallback((tag: string) => {
        onTagsChange(tags.filter(t => t !== tag));
    }, [tags, onTagsChange]);

    return (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800">
            {tags.map(tag => (
                <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
                        aria-label={`Remove tag ${tag}`}
                    >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </span>
            ))}
            <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => { if (input.trim()) addTags(input); }}
                placeholder={tags.length === 0 ? "Add tags (comma separated)..." : ""}
                className="min-w-[120px] flex-1 border-none bg-transparent px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-hidden dark:text-slate-200 dark:placeholder:text-slate-500"
            />
        </div>
    );
}
