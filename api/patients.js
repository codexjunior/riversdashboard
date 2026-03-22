/**
 * /api/patients.js
 * GET    /api/patients?token=&password=&search=&page=&limit=
 * GET    /api/patients?token=&password=&ref=RDC/26/001
 * POST   /api/patients  { token, password, ...patientFields }
 * PUT    /api/patients  { token, password, reference_number, ...fields }
 */

const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
}

function auth(body) {
  return body.token === process.env.DASHBOARD_TOKEN &&
         body.password === process.env.DASHBOARD_PASSWORD;
}

function authQuery(query) {
  return query.token === process.env.DASHBOARD_TOKEN &&
         query.password === process.env.DASHBOARD_PASSWORD;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = getSupabase();

  // ── GET — list or single patient ─────────────────────────────────────────
  if (req.method === "GET") {
    if (!authQuery(req.query)) return res.status(401).json({ error: "Unauthorized" });

    // Single patient by reference number
    if (req.query.ref) {
      const { data, error } = await supabase
        .from("patients")
        .select("*")
        .eq("reference_number", req.query.ref)
        .single();
      if (error) return res.status(404).json({ error: "Patient not found" });
      return res.status(200).json({ patient: data });
    }

    // List with search and pagination
    const page  = parseInt(req.query.page  || "1");
    const limit = parseInt(req.query.limit || "20");
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    let query = supabase
      .from("patients")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(
        `reference_number.ilike.%${search}%,` +
        `phone.ilike.%${search}%,` +
        `email.ilike.%${search}%,` +
        `city.ilike.%${search}%`
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
    if (!body.reference_number) return res.status(400).json({ error: "reference_number is required" });

    const { token, password, ...fields } = body;

    // Upsert — insert or update if reference already exists
    const { data, error } = await supabase
      .from("patients")
      .upsert(fields, { onConflict: "reference_number" })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, patient: data });
  }

  // ── PUT — update patient fields ───────────────────────────────────────────
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
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, patient: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
