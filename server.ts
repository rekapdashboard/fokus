import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to support JSON request payloads up to 10MB
  app.use(express.json({ limit: "10mb" }));

  // Ensure server cache directory for shared dashboards exists
  const cacheDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // API Route to save the synchronized dashboard state to server disk cache
  app.post("/api/save-dashboard", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { spreadsheetId, sheetTabs, activeTab, records, targets, lastSyncedTime } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required" });
    }

    const payload = {
      spreadsheetId,
      sheetTabs: sheetTabs || [],
      activeTab: activeTab || "DASHBOARD",
      records: records || [],
      targets: targets || null,
      lastSyncedTime: lastSyncedTime || null,
    };

    try {
      const filePath = path.join(cacheDir, `dashboard_${spreadsheetId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(payload), "utf-8");
      console.log(`[Cache] Successfully persistent-cached dashboard for ID: ${spreadsheetId}`);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Cache Error] Failed saving dashboard cache file:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // API Route to load the persisted dashboard state
  app.get("/api/get-dashboard", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { spreadsheetId } = req.query;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required" });
    }

    try {
      const filePath = path.join(cacheDir, `dashboard_${spreadsheetId}.json`);
      if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf-8");
        return res.setHeader("Content-Type", "application/json").send(text);
      }
      return res.status(404).json({ error: "No cached dashboard found on server" });
    } catch (err: any) {
      console.error("[Cache Error] Failed reading dashboard cache file:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Let's add proxy endpoints to bypass client-side CORS issues for public sheets
  app.get("/api/proxy/htmlview", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { spreadsheetId } = req.query;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required" });
    }
    try {
      console.log(`[Proxy] Fetching htmlview for spreadsheetId: ${spreadsheetId}`);
      const response = await fetch(
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
          }
        }
      );
      if (!response.ok) {
        console.error(`[Proxy Error] htmlview fetch failed with status: ${response.status} (${response.statusText})`);
        return res.status(response.status).json({ error: `Gagal memuat htmlview: ${response.statusText}` });
      }
      const text = await response.text();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(text);
    } catch (err: any) {
      console.error("[Proxy Error] htmlview catch block:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/proxy/csv", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const { spreadsheetId, sheet } = req.query;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required" });
    }
    try {
      const sheetParam = sheet ? `&sheet=${encodeURIComponent(sheet as string)}` : "";
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${sheetParam}`;
      console.log(`[Proxy] Fetching CSV for spreadsheetId: ${spreadsheetId}, sheet: ${sheet || "default"}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      if (!response.ok) {
        console.error(`[Proxy Error] CSV fetch failed with status: ${response.status} (${response.statusText})`);
        return res.status(response.status).json({ error: `Gagal memuat csv: ${response.statusText}` });
      }
      const text = await response.text();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.send(text);
    } catch (err: any) {
      console.error("[Proxy Error] CSV catch block:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/proxy/sheets", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const { path: gPath } = req.query;
    if (!gPath) {
      return res.status(400).json({ error: "path parameter is required" });
    }

    const pathStr = gPath as string;
    if (!pathStr.startsWith("/v4/spreadsheets")) {
      return res.status(400).json({ error: "Invalid path segment specified" });
    }

    const authHeader = req.headers.authorization;
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    try {
      const url = `https://sheets.googleapis.com${pathStr}`;
      console.log(`[Proxy] Fetching Sheets API: ${url}`);
      
      const response = await fetch(url, { headers });
      res.status(response.status);
      
      const text = await response.text();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.send(text);
    } catch (err: any) {
      console.error("[Proxy Error] Sheets API catch block:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
