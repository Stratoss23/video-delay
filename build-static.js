const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");
const staticFiles = ["index.html", "style.css", "app.js", "manifest.webmanifest", "sw.js", "icon.svg"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const mimeTypes = {
  "index.html": "text/html; charset=utf-8",
  "style.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "manifest.webmanifest": "application/manifest+json; charset=utf-8",
  "sw.js": "text/javascript; charset=utf-8",
  "icon.svg": "image/svg+xml; charset=utf-8"
};

const assets = Object.fromEntries(
  staticFiles.map((file) => [
    file,
    {
      body: fs.readFileSync(path.join(root, file), "utf8"),
      type: mimeTypes[file]
    }
  ])
);

const worker = `const assets = ${JSON.stringify(assets)};

function assetNameFromUrl(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/^\\/+/, "");
  return pathname === "" ? "index.html" : pathname;
}

export default {
  async fetch(request) {
    const name = assetNameFromUrl(request.url);
    const asset = assets[name] || assets["index.html"];
    return new Response(asset.body, {
      headers: {
        "content-type": asset.type,
        "cache-control": "no-cache"
      }
    });
  }
};
`;

fs.writeFileSync(path.join(dist, "index.js"), worker);

fs.mkdirSync(path.join(dist, ".openai"), { recursive: true });
fs.copyFileSync(path.join(root, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));
