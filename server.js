const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve static files ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Load all API files from /api folder ───────────────────────────────────────
const apiDir = path.join(__dirname, "api");
fs.readdirSync(apiDir).forEach(file => {
  if (!file.endsWith(".js")) return;
  const routeName = file.replace(".js", "");
  const handler   = require(path.join(apiDir, file));
  app.all(`/api/${routeName}`, handler);
  console.log(`  ✓ /api/${routeName}`);
});

// ── Fallback — serve index.html ───────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rivers Dental Dashboard running on port ${PORT}`);
});
