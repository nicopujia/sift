// Serves saved page snapshots from research/snapshots on http://127.0.0.1:8799/<name>
// with scripts stripped, a <base> for the real site, and a meta tag that tells
// Sift which real URL the page came from (so site adapters match).
const root = new URL("../research/snapshots/", import.meta.url).pathname;
const origins: Record<string, string> = {
  "amazon-search": "https://www.amazon.com/s?k=wireless+headphones",
  "amazon-product": "https://www.amazon.com/dp/B0C3HCD34R",
  "amazon-cart": "https://www.amazon.com/gp/cart/view.html",
  "dailymail-home": "https://www.dailymail.com/ushome/index.html",
  "dailymail-article": "https://www.dailymail.com/news/article-16234901/US-intelligence-memo-Iran-plots-assassinations.html",
  "dailymail-article-video": "https://www.dailymail.com/news/article-16233447/new-jersey-mayor-matthew-bianchini-attack-resident-town-meeting.html",
  "youtube-home-warm": "https://www.youtube.com/",
  "youtube-watch": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "gmail-inbox": "https://mail.google.com/mail/u/0/#inbox",
  "gmail-thread": "https://mail.google.com/mail/u/0/#inbox/thread",
};
Bun.serve({
  port: 8799,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/fx/")) {
      // Hand-made fixtures run as they are, scripts included.
      const fx = Bun.file(root + "../fixtures/" + path.slice(4).replace(/\.html$/, "") + ".html");
      return (await fx.exists()) ? new Response(fx, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404 });
    }
    const name = path.slice(1).replace(/\.html$/, "");
    const file = Bun.file(root + name + ".html");
    if (!name || !(await file.exists())) return new Response("not found", { status: 404 });
    let html = await file.text();
    html = html.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "");
    const real = origins[name] ?? "";
    const inject = `<meta name="sift-test-url" content="${real}">` + (real ? `<base href="${new URL(real).origin}/">` : "");
    html = html.replace(/<head[^>]*>/i, (m) => m + inject);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log("serving snapshots on http://127.0.0.1:8799/");
