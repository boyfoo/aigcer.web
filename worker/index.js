export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const pageUrl = new URL(request.url);
    if (pageUrl.pathname.startsWith("/api/") || pageUrl.pathname.startsWith("/_next/")) return response;
    if (/\.[^/]+$/.test(pageUrl.pathname) && !pageUrl.pathname.endsWith(".html")) return response;

    const pathname = pageUrl.pathname.replace(/\/$/, "");
    pageUrl.search = "";
    pageUrl.pathname = pathname ? `${pathname}.html` : "/index.html";
    const pageResponse = await env.ASSETS.fetch(new Request(pageUrl, request));
    if (pageResponse.status !== 404) return pageResponse;

    pageUrl.pathname = "/404.html";
    const notFound = await env.ASSETS.fetch(new Request(pageUrl, request));
    if (!notFound.ok) return response;
    return new Response(request.method === "HEAD" ? null : notFound.body, {
      status: 404,
      headers: notFound.headers,
    });
  },
};
