import {
  classifyTimedTextCandidate,
  normalizeMimeType,
} from "../lib/timed-text/detect";
import type { TimedTextResource, TimedTextSource } from "../types/discovery";

export {};

const CAPTURE_EVENT = "video-transcript-resource";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const globalState = globalThis as typeof globalThis & {
  __videoTranscriptMainInstalled?: boolean;
};

function dispatchResource(resource: TimedTextResource): void {
  document.dispatchEvent(new CustomEvent(CAPTURE_EVENT, {
    detail: JSON.stringify(resource),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readBoundedText(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MAX_BODY_BYTES ? text : null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    received += item.value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel("Timed-text candidate exceeded the inspection limit");
      return null;
    }
    text += decoder.decode(item.value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function inspectResponse(
  response: Response,
  url: string,
  source: TimedTextSource,
  metadata: Pick<TimedTextResource, "language" | "label" | "kind" | "trackId"> = {},
): Promise<void> {
  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  const classification = classifyTimedTextCandidate(url, mimeType);
  if (!classification.matched) return;

  const base: TimedTextResource = {
    url,
    mimeType,
    format: classification.format,
    source,
    ...metadata,
  };
  if (!classification.inspectBody) {
    dispatchResource(base);
    return;
  }

  try {
    const bodyText = await readBoundedText(response.clone());
    dispatchResource(bodyText === null
      ? { ...base, error: "Candidate body exceeded the 2 MiB inspection limit." }
      : { ...base, bodyText });
  } catch (error) {
    dispatchResource({ ...base, error: errorMessage(error) });
  }
}

const originalFetch = window.fetch.bind(window);

function canFetchFromPage(value: string): boolean {
  const url = new URL(value, location.href);
  return url.protocol === "blob:"
    || url.protocol === "data:"
    || url.origin === location.origin;
}

async function fetchResource(resource: TimedTextResource): Promise<void> {
  const crossOrigin = new URL(resource.url, location.href).origin !== location.origin;
  const credentialModes: RequestCredentials[] = crossOrigin
    ? ["omit", "include"]
    : ["include"];
  let failure = "Timed-text resource could not be fetched.";
  for (const credentials of credentialModes) {
    try {
      const response = await originalFetch(resource.url, { credentials });
      if (!response.ok) {
        failure = `Timed-text resource returned HTTP ${response.status}.`;
        continue;
      }
      await inspectResponse(response, resource.url, resource.source, resource);
      return;
    } catch (error) {
      failure = errorMessage(error);
    }
  }
  dispatchResource({ ...resource, error: failure });
}

function installFetchInterceptor(): void {
  window.fetch = async function timedTextFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await originalFetch(input, init);
    const url = typeof input === "string"
      ? new URL(input, location.href).href
      : input instanceof URL
        ? input.href
        : input.url;
    void inspectResponse(response, url, "fetch");
    return response;
  };
}

interface InspectedXhr extends XMLHttpRequest {
  __videoTranscriptUrl?: string;
}

function installXhrInterceptor(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function timedTextOpen(
    this: InspectedXhr,
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ): void {
    this.__videoTranscriptUrl = new URL(url.toString(), location.href).href;
    Reflect.apply(originalOpen, this, [
      method,
      url,
      async,
      username ?? null,
      password ?? null,
    ]);
  };

  XMLHttpRequest.prototype.send = function timedTextSend(
    this: InspectedXhr,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    this.addEventListener("loadend", () => {
      const url = this.__videoTranscriptUrl;
      if (!url) return;
      const mimeType = normalizeMimeType(this.getResponseHeader("content-type"));
      const classification = classifyTimedTextCandidate(url, mimeType);
      if (!classification.matched) return;
      const resource: TimedTextResource = {
        url,
        mimeType,
        format: classification.format,
        source: "xhr",
      };
      if (!classification.inspectBody) {
        dispatchResource(resource);
        return;
      }
      try {
        if (this.responseType === "" || this.responseType === "text") {
          const bodyText = this.responseText ?? "";
          const byteLength = new TextEncoder().encode(bodyText).byteLength;
          dispatchResource(byteLength <= MAX_BODY_BYTES
            ? { ...resource, bodyText }
            : { ...resource, error: "Candidate body exceeded the 2 MiB inspection limit." });
        } else if (this.responseType === "json") {
          const bodyText = JSON.stringify(this.response ?? null);
          dispatchResource(new TextEncoder().encode(bodyText).byteLength <= MAX_BODY_BYTES
            ? { ...resource, bodyText }
            : { ...resource, error: "Candidate body exceeded the 2 MiB inspection limit." });
        } else {
          dispatchResource(resource);
        }
      } catch (error) {
        dispatchResource({ ...resource, error: errorMessage(error) });
      }
    }, { once: true });
    originalSend.call(this, body ?? null);
  };
}

function inspectPerformanceResources(): void {
  for (const entry of performance.getEntriesByType("resource")) {
    const classification = classifyTimedTextCandidate(entry.name);
    if (!classification.matched) continue;
    const resource: TimedTextResource = {
      url: entry.name,
      mimeType: "",
      format: classification.format,
      source: "performance",
    };
    if (classification.inspectBody && canFetchFromPage(resource.url)) {
      void fetchResource(resource);
    } else {
      dispatchResource(resource);
    }
  }
}

function inspectTrackElements(): void {
  for (const element of document.querySelectorAll<HTMLTrackElement>("video track[src], audio track[src]")) {
    const url = element.src;
    const classification = classifyTimedTextCandidate(url, element.getAttribute("type"));
    const resource: TimedTextResource = {
      url,
      mimeType: normalizeMimeType(element.getAttribute("type")),
      format: classification.format,
      source: url.startsWith("blob:")
        ? "blob"
        : url.startsWith("data:")
          ? "data"
          : "track",
      language: element.srclang,
      label: element.label,
      kind: element.kind,
    };
    if (canFetchFromPage(resource.url)) {
      void fetchResource(resource);
    } else {
      dispatchResource(resource);
    }
  }
}

function installBlobInterceptor(): void {
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function timedTextObjectUrl(object: Blob | MediaSource): string {
    const url = originalCreateObjectUrl(object);
    if (object instanceof Blob) {
      const classification = classifyTimedTextCandidate(url, object.type);
      if (classification.matched && classification.inspectBody) {
        void fetchResource({
          url,
          mimeType: normalizeMimeType(object.type),
          format: classification.format,
          source: "blob",
        });
      }
    }
    return url;
  };
}

function install(): void {
  if (globalState.__videoTranscriptMainInstalled) {
    inspectTrackElements();
    inspectPerformanceResources();
    return;
  }
  globalState.__videoTranscriptMainInstalled = true;
  installFetchInterceptor();
  installXhrInterceptor();
  installBlobInterceptor();
  inspectTrackElements();
  inspectPerformanceResources();
  new MutationObserver(() => inspectTrackElements()).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "kind", "srclang", "label"],
  });
}

install();
