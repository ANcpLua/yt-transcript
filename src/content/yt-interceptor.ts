// MAIN-world content script — runs in the page's JS context, not the
// extension's isolated world. Patches window.fetch and XMLHttpRequest at
// document_start, before YouTube's bundle initialises and stores its
// own fetch reference in a closure variable. We observe responses to a
// fixed allowlist of three YouTube transcript endpoints; everything
// else is pass-through with O(1) overhead. Captured payloads are sent
// to the ISOLATED-world bridge via CustomEvent("yt-tx-capture") since
// MAIN-world scripts have no access to chrome.* APIs.
//
// Privacy: we only ever .clone() and read responses whose URL matches
// the allowlist. Anything else is never read, never logged, never
// transmitted.

export {};

const HOT_PATHS = [
  "/youtubei/v1/get_transcript",
  "/youtubei/v1/player",
  "/api/timedtext",
] as const;

function shouldCapture(url: string): boolean {
  for (const p of HOT_PATHS) if (url.includes(p)) return true;
  return false;
}

interface CapturePayload {
  url: string;
  status: number;
  bodyText: string;
  requestBody: string;
  ts: number;
}

function dispatchCapture(payload: CapturePayload): void {
  try {
    document.dispatchEvent(
      new CustomEvent("yt-tx-capture", {
        detail: JSON.stringify(payload),
      }),
    );
  } catch {
    // Never throw out of an interceptor — page comes first.
  }
}

// ---------- fetch patch ----------

const origFetch: typeof window.fetch = window.fetch.bind(window);

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!shouldCapture(url)) return origFetch(input, init);

  let requestBody = "";
  if (init?.body && typeof init.body === "string") {
    requestBody = init.body;
  } else if (input instanceof Request) {
    try {
      requestBody = await input.clone().text();
    } catch {
      requestBody = "";
    }
  }

  const res = await origFetch(input, init);

  res
    .clone()
    .text()
    .then((bodyText) => {
      dispatchCapture({
        url,
        status: res.status,
        bodyText,
        requestBody,
        ts: Date.now(),
      });
    })
    .catch(() => {});

  return res;
};

// ---------- XMLHttpRequest patch ----------

const origOpen = XMLHttpRequest.prototype.open;
const origSend = XMLHttpRequest.prototype.send;

interface PatchedXhr extends XMLHttpRequest {
  __ytTxUrl?: string;
  __ytTxRequestBody?: string;
}

XMLHttpRequest.prototype.open = function open(
  this: PatchedXhr,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  const u = typeof url === "string" ? url : url.toString();
  if (shouldCapture(u)) this.__ytTxUrl = u;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (origOpen as any).apply(this, [method, url, ...rest]);
} as typeof XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.send = function send(
  this: PatchedXhr,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  if (this.__ytTxUrl) {
    if (typeof body === "string") this.__ytTxRequestBody = body;
    else this.__ytTxRequestBody = "";

    this.addEventListener(
      "loadend",
      () => {
        if (!this.__ytTxUrl) return;
        let bodyText = "";
        try {
          if (this.responseType === "" || this.responseType === "text") {
            bodyText = this.responseText ?? "";
          } else if (this.responseType === "json") {
            bodyText = JSON.stringify(this.response ?? null);
          }
        } catch {
          bodyText = "";
        }
        dispatchCapture({
          url: this.__ytTxUrl,
          status: this.status,
          bodyText,
          requestBody: this.__ytTxRequestBody ?? "",
          ts: Date.now(),
        });
      },
      { once: true },
    );
  }
  return origSend.call(this, body ?? null);
};

// ---------- SPA navigation tap (Phase 1 will use this) ----------

document.addEventListener("yt-navigate-finish", () => {
  try {
    document.dispatchEvent(
      new CustomEvent("yt-tx-navigate", {
        detail: JSON.stringify({ url: window.location.href, ts: Date.now() }),
      }),
    );
  } catch {
    // pass
  }
});
