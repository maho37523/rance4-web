/**
 * A deliberately narrow Internet Archive proxy for the browser CD loader.
 * Replace the two TODO constants after publishing the permitted archive.
 */
export const ARCHIVE_IDENTIFIER = "TODO_REPLACE_WITH_ARCHIVE_IDENTIFIER";
export const ARCHIVE_FILES = Object.freeze({
  img: "TODO_REPLACE_WITH_CD_IMAGE_FILENAME.img",
  cue: "TODO_REPLACE_WITH_CUE_FILENAME.cue",
});
// Use the exact IA data node recorded for the approved item (for example,
// https://ia123456.us.archive.org), never the redirecting general endpoint.
export const ARCHIVE_HOST = "https://TODO_REPLACE_WITH_ARCHIVE_DATA_HOST";
export const ALLOWED_ORIGIN = "https://maho37523.github.io";
export const IMG_RANGE_LIMIT = 16 * 1024 * 1024;
export const CUE_LIMIT = 1024 * 1024;

const ROUTES = Object.freeze({
  "/v1/ranceking/cd.img": "img",
  "/v1/ranceking/cd.cue": "cue",
});

function corsHeaders(origin) {
  const h = new Headers({ Vary: "Origin" });
  if (origin === ALLOWED_ORIGIN) {
    h.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range, Content-Type");
    h.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type");
  }
  return h;
}

function response(status, body, request, headers) {
  const h = corsHeaders(request.headers.get("Origin"));
  if (headers) for (const [key, value] of headers) h.set(key, value);
  return new Response(body, { status, headers: h });
}

function parseImgRange(value) {
  if (!value) return null;
  // Only one forward range is supported. Suffix ranges and comma lists are not.
  const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(value);
  if (!match || match[2] === "0" && match[1] !== "0") return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  if (end - start + 1 > IMG_RANGE_LIMIT) return null;
  return { start, end };
}

function upstreamUrl(kind) {
  return `${ARCHIVE_HOST}/download/${encodeURIComponent(ARCHIVE_IDENTIFIER)}/${encodeURIComponent(ARCHIVE_FILES[kind])}`;
}

function boundedBody(body, limit) {
  if (!body) return body;
  let total = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > limit) {
        controller.error(new Error("upstream body exceeds limit"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

async function proxyImg(request, fetchImpl) {
  const range = parseImgRange(request.headers.get("Range"));
  if (!range) return response(416, "Invalid Range", request, [["Accept-Ranges", "bytes"]]);
  const upstream = new Request(upstreamUrl("img"), {
    method: request.method,
    headers: new Headers([["Range", request.headers.get("Range")]]),
    redirect: "error",
  });
  const result = await fetchImpl(upstream);
  const contentRange = result.headers.get("Content-Range");
  const match = contentRange && /^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/.exec(contentRange);
  if (result.status !== 206 || !match) return response(502, "Invalid archive response", request);
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(total) || start !== range.start || end !== range.end || end < start || end >= total || end - start + 1 > IMG_RANGE_LIMIT) {
    return response(502, "Invalid archive range", request);
  }
  const length = result.headers.get("Content-Length");
  if (length !== null && Number(length) !== end - start + 1) return response(502, "Invalid archive length", request);
  const headers = [["Accept-Ranges", "bytes"], ["Content-Range", contentRange], ["Content-Type", result.headers.get("Content-Type") || "application/octet-stream"]];
  if (length !== null) headers.push(["Content-Length", length]);
  return response(206, request.method === "HEAD" ? null : boundedBody(result.body, IMG_RANGE_LIMIT), request, headers);
}

async function proxyCue(request, fetchImpl) {
  const result = await fetchImpl(new Request(upstreamUrl("cue"), { method: request.method, redirect: "error" }));
  const length = result.headers.get("Content-Length");
  if (result.status !== 200 || (length !== null && (!/^\d+$/.test(length) || Number(length) > CUE_LIMIT))) return response(502, "Invalid archive response", request);
  const headers = [["Content-Type", result.headers.get("Content-Type") || "text/plain; charset=utf-8"]];
  if (length !== null) headers.push(["Content-Length", length]);
  return response(200, request.method === "HEAD" ? null : boundedBody(result.body, CUE_LIMIT), request, headers);
}

export async function handleRequest(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  const kind = url.search === "" ? ROUTES[url.pathname] : undefined;
  if (!kind) return response(404, "Not found", request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
  if (request.method !== "GET" && request.method !== "HEAD") return response(405, "Method not allowed", request, [["Allow", "GET, HEAD, OPTIONS"]]);
  try { return kind === "img" ? await proxyImg(request, fetchImpl) : await proxyCue(request, fetchImpl); }
  catch { return response(502, "Archive unavailable", request); }
}

export default { fetch: (request, env, ctx) => handleRequest(request) };
