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
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
            {tags.map(tag => (
                <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                        aria-label={`Remove tag ${tag}`}
                    >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
                placeholder={tags.length === 0 ? "Add tags…" : ""}
                className="min-w-[100px] flex-1 border-none bg-transparent px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-hidden dark:text-slate-200 dark:placeholder:text-slate-500"
            />
        </div>
    );
}
