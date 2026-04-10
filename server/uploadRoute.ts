import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { getDb } from "./db";
import { importJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ];
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === "csv" || ext === "xlsx" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and Excel files are allowed"));
    }
  },
});

export function registerUploadRoutes(app: Router | any) {
  app.post("/api/upload/meta-report", upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = req.file;
      const ext = file.originalname.split(".").pop()?.toLowerCase();

      let rows: Record<string, any>[] = [];

      if (ext === "csv") {
        // Parse CSV using XLSX
        const workbook = XLSX.read(file.buffer, { type: "buffer", raw: false });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      } else if (ext === "xlsx" || ext === "xls") {
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      } else {
        return res.status(400).json({ error: "Unsupported file format" });
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: "File is empty or has no data rows" });
      }

      // Detect columns
      const columns = Object.keys(rows[0]);

      // Auto-detect column mapping based on common Meta Ads report column names
      const mapping: Record<string, string> = {};
      const metaMappings: Record<string, string[]> = {
        campaign_name: ["Campaign name", "campaign_name", "Campaign Name", "Nom de la campagne"],
        campaign_id: ["Campaign ID", "campaign_id"],
        adset_name: ["Ad set name", "adset_name", "Ad Set Name"],
        adset_id: ["Ad set ID", "adset_id"],
        ad_name: ["Ad name", "ad_name"],
        ad_id: ["Ad ID", "ad_id"],
        date: ["Day", "Date", "date", "Reporting starts", "Report Date"],
        spend: ["Amount spent (USD)", "Amount spent", "Spend", "spend", "Cost", "Amount Spent (USD)", "Amount Spent"],
        impressions: ["Impressions", "impressions"],
        clicks: ["Clicks (all)", "Link clicks", "Clicks", "clicks"],
        ctr: ["CTR (all)", "CTR (link click-through rate)", "CTR", "ctr"],
        cpc: ["CPC (all)", "CPC (cost per link click)", "CPC", "cpc"],
        cpm: ["CPM (cost per 1,000 impressions)", "CPM", "cpm"],
        reach: ["Reach", "reach"],
        leads: ["Leads", "leads", "Lead generation"],
        conversions: ["Results", "Conversions", "conversions", "Purchases"],
        revenue: ["Purchase ROAS (return on ad spend)", "Revenue", "revenue", "Purchase conversion value"],
        country: ["Country", "country", "Region"],
      };

      for (const [key, candidates] of Object.entries(metaMappings)) {
        const found = candidates.find(c => columns.includes(c));
        if (found) mapping[key] = found;
      }

      // Keep only first 5 rows as preview (don't store full data to avoid DB size issues)
      const previewRows = rows.slice(0, 5);
      const allRows = rows; // full data for import

      // Create import job in DB
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: "Database unavailable" });
      }

      const source = ext === "csv" ? "meta_csv" : "meta_excel";

      const [result] = await db.insert(importJobs).values({
        fileName: file.originalname,
        fileSize: file.size,
        source: source as any,
        status: "pending",
        totalRows: rows.length,
        importedRows: 0,
        skippedRows: 0,
        columnMapping: mapping,
        previewData: allRows, // store all rows for import
      });

      const jobId = (result as any).insertId;

      return res.json({
        success: true,
        jobId,
        fileName: file.originalname,
        totalRows: rows.length,
        columns,
        mapping,
        preview: previewRows,
      });
    } catch (err: any) {
      console.error("[Upload] Error:", err);
      return res.status(500).json({ error: err.message || "Upload failed" });
    }
  });
}
