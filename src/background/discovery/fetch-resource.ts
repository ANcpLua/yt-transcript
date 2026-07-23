import type { TimedTextResource } from "../../types/discovery";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error("Timed-text candidate exceeded the 2 MiB inspection limit.");
  }
  if (!response.body) {
    const bodyText = await response.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      throw new Error("Timed-text candidate exceeded the 2 MiB inspection limit.");
    }
    return bodyText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let bodyText = "";
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    received += item.value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel("Timed-text candidate exceeded the inspection limit");
      throw new Error("Timed-text candidate exceeded the 2 MiB inspection limit.");
    }
    bodyText += decoder.decode(item.value, { stream: true });
  }
  return bodyText + decoder.decode();
}

export async function fetchTimedTextResource(
  resource: TimedTextResource,
): Promise<TimedTextResource> {
  let failure = "Timed-text resource could not be fetched.";
  for (const credentials of ["omit", "include"] as const) {
    try {
      const response = await fetch(resource.url, { credentials });
      if (!response.ok) {
        failure = `Timed-text resource returned HTTP ${response.status}.`;
        continue;
      }
      return {
        ...resource,
        mimeType: response.headers.get("content-type") ?? resource.mimeType,
        bodyText: await readBoundedText(response),
        error: undefined,
      };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  return { ...resource, error: failure };
}
