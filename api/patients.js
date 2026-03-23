/**
 * /api/patients.js
 * GET    /api/patients?token=&password=&search=&page=&limit=
 * GET    /api/patients?token=&password=&ref=RDC/26/001
 * GET    /api/patients?token=&password=&action=next-ref   ← generate next reference
 * POST   /api/patients  { token, password, ...patientFields }
 * PUT    /api/patients  { token, password, reference_number, ...fields }
 */

const { createClient } = require("@supabase/supabase-js");
const { google }       = require("googleapis");

const SHEET_COLUMNS = [
  "reference_number", "name", "gender", "age_category",
  "phone", "whatsapp", "birthdate", "email",
  "city", "company", "profession",
  "emergency_contact_name", "emergency_contact_relation", "emergency_contact_phone"
];

const GENDER_MAP       = { 0: "MALE", 1: "FEMALE" };
const AGE_CATEGORY_MAP = { 0: "CHILD", 1: "TEENAGER", 2: "ADULT", 3: "SENIOR" };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function auth(body) {
  return body.token === process.env.DASHBOARD_TOKEN &&
         body.password === process.env.DASHBOARD_PASSWORD;
}

function authQuery(query) {
  return query.token === process.env.DASHBOARD_TOKEN &&
         query.password === process.env.DASHBOARD_PASSWORD;
}

// ─── Generate next reference number ──────────────────────────────────────────
async function getNextReference(supabase) {
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `RDC/${year}/`;

  // Get the highest sequence number for this year
  const { data } = await supabase
    .from("patients")
    .select("reference_number")
    .like("reference_number", `${prefix}%`)
    .order("reference_number", { ascending: false })
    .limit(1);

  let nextSeq = 1;
  if (data && data.length > 0) {
    const parts = data[0].reference_number.split("/");
    nextSeq = parseInt(parts[2]) + 1;
  }

  return `${prefix}${nextSeq}`;
}

// ─── Sync patient row to Google Sheets ───────────────────────────────────────
async function syncToSheets(patient, isNew) {
  if (!process.env.GOOGLE_SHEET_ID) return;
  try {
    const sheets   = getSheets();
    const sheetId  = process.env.GOOGLE_SHEET_ID;
    const range    = "Patient_data!A:O";

    // Build the row values in sheet column order
    // Sheet columns: Timestamp | Reference | Name | Gender | Age Category |
    //                Phone | WhatsApp | Birthdate | Email | City |
    //                Company | Profession | Emergency Name | Emergency Relation | Emergency Phone
    const now = new Date().toISOString();
    const row = [
      isNew ? now : "",                                          // Timestamp (only for new rows)
      patient.reference_number                        || "",
      patient.name                                    || "",
      patient.gender !== null && patient.gender !== undefined
        ? (GENDER_MAP[patient.gender] || "")          : "",
      patient.age_category !== null && patient.age_category !== undefined
        ? (AGE_CATEGORY_MAP[patient.age_category] || "") : "",
      patient.phone                                   || "",
      patient.whatsapp                                || "",
      patient.birthdate                               || "",
      patient.email                                   || "",
      patient.city                                    || "",
      patient.company                                 || "",
      patient.profession                              || "",
      patient.emergency_contact_name                  || "",
      patient.emergency_contact_relation              || "",
      patient.emergency_contact_phone                 || "",
    ];

    if (isNew) {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
    } else {
      // Find existing row by reference number and update it
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "Patient_data!B:B", // Reference number column
      });

      const rows = existing.data.values || [];
      let rowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === patient.reference_number) {
          rowIndex = i + 1; // 1-based
          break;
        }
      }

      if (rowIndex > 0) {
        // Update existing row — keep timestamp, update everything else
        const updateRow = [...row];
        updateRow[0] = ""; // Don't overwrite timestamp
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `Patient_data!A${rowIndex}:O${rowIndex}`,
          valueInputOption: "RAW",
          requestBody: { values: [updateRow] },
        });
      } else {
        // Row not found in sheet — append it
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range,
          valueInputOption: "RAW",
          requestBody: { values: [row] },
        });
      }
    }
  } catch (err) {
    console.error("[patients] Sheets sync error:", err.message);
    // Don't fail the request if sheets sync fails
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = getSupabase();

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (!authQuery(req.query)) return res.status(401).json({ error: "Unauthorized" });

    // Generate next reference number
    if (req.query.action === "next-ref") {
      const ref = await getNextReference(supabase);
      return res.status(200).json({ reference: ref });
    }

    // Single patient
    if (req.query.ref) {
      const { data, error } = await supabase
        .from("patients").select("*")
        .eq("reference_number", req.query.ref).single();
      if (error) return res.status(404).json({ error: "Patient not found" });
      return res.status(200).json({ patient: data });
    }

    // List with search and pagination
    const page   = parseInt(req.query.page  || "1");
    const limit  = parseInt(req.query.limit || "20");
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    let query = supabase
      .from("patients")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      // Name uses contains, reference and phone use starts-with
      query = query.or(
        `name.ilike.%${search}%,` +
        `reference_number.ilike.${search}%,` +
        `phone.ilike.${search}%`
      );
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ patients: data, total: count, page, limit });
  }

  // ── POST — create patient ─────────────────────────────────────────────────
  if (req.method === "POST") {
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Invalid JSON" }); }
    if (!auth(body)) return res.status(401).json({ error: "Unauthorized" });

    // Auto-generate reference if not provided
    if (!body.reference_number) {
      body.reference_number = await getNextReference(supabase);
    }

    const { token, password, ...fields } = body;

    const { data, error } = await supabase
      .from("patients")
      .upsert(fields, { onConflict: "reference_number" })
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Sync to Google Sheets
    await syncToSheets(data, true);

    return res.status(200).json({ success: true, patient: data });
  }

  // ── PUT — update patient ──────────────────────────────────────────────────
  if (req.method === "PUT") {
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Invalid JSON" }); }
    if (!auth(body)) return res.status(401).json({ error: "Unauthorized" });
    if (!body.reference_number) return res.status(400).json({ error: "reference_number is required" });

    const { token, password, reference_number, ...fields } = body;

    const { data, error } = await supabase
      .from("patients")
      .update(fields)
      .eq("reference_number", reference_number)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Sync to Google Sheets
    await syncToSheets({ ...data, reference_number }, false);

    return res.status(200).json({ success: true, patient: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
