/**
 * Convert a video title + language into a safe filename.
 * Replaces illegal characters, collapses dashes, trims to 80 chars, appends language + extension.
 */
export function sanitizeFilename(
    title: string,
    lang: string,
    extension: string,
): string {
    const sanitized = title
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-") // illegal filesystem chars
        .replace(/[^\w\s.-]/g, "-") // non-word chars except spaces, dots, hyphens
        .replace(/\s+/g, "-") // spaces to hyphens
        .replace(/-{2,}/g, "-") // collapse multiple dashes
        .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
        .slice(0, 80);

    const base = sanitized || "transcript";
    const ext = extension.startsWith(".") ? extension : `.${extension}`;

    return `${base}_${lang}${ext}`;
}
