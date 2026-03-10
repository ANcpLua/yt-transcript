/**
 * Format seconds to MM:SS for display.
 * Example: 65.5 -> "01:05"
 */
export function formatTimestamp(seconds: number): string {
    const totalSeconds = Math.floor(Math.max(0, seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Format seconds to HH:MM:SS,mmm for SRT files.
 * Example: 65.5 -> "00:01:05,500"
 */
export function formatSrtTime(seconds: number): string {
    const clamped = Math.max(0, seconds);
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const secs = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);

    return (
        `${String(hours).padStart(2, "0")}:` +
        `${String(minutes).padStart(2, "0")}:` +
        `${String(secs).padStart(2, "0")},` +
        `${String(ms).padStart(3, "0")}`
    );
}

/**
 * Format seconds to HH:MM:SS.mmm for VTT files.
 * Example: 65.5 -> "00:01:05.500"
 */
export function formatVttTime(seconds: number): string {
    const clamped = Math.max(0, seconds);
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const secs = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);

    return (
        `${String(hours).padStart(2, "0")}:` +
        `${String(minutes).padStart(2, "0")}:` +
        `${String(secs).padStart(2, "0")}.` +
        `${String(ms).padStart(3, "0")}`
    );
}
