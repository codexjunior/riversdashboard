/**
 * /api/invoices.js
 * GET    /api/invoices?token=&password=&ref=RDC/26/001
 * POST   /api/invoices  { token, password, reference_number, date, procedure, amount, paid }
 * PUT    /api/invoices  { token, password, id, paid }
 * DELETE /api/invoices  { token, password, id }
 */

const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
}

function auth(obj) {
  return obj.token === process.env.DASHBOARD_TOKEN &&
         obj.password === process.env.DASHBOARD_PASSWORD;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = getSupabase();

  // ── GET — invoices for a patient ──────────────────────────────────────────
  if (req.method === "GET") {
    if (!auth(req.query)) return res.status(401).json({ error: "Unauthorized" });
    if (!req.query.ref) return res.status(400).json({ error: "ref is required" });

    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("reference_number", req.query.ref)
      .order("date", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const total = data.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
    const unpaid = data.filter(i => !i.paid).reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

    return res.status(200).json({ invoices: data, total, unpaid });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }
  if (!auth(body)) return res.status(401).json({ error: "Unauthorized" });

  // ── POST — create invoice ─────────────────────────────────────────────────
  if (req.method === "POST") {
    const { token, password, ...fields } = body;
    if (!fields.reference_number || !fields.date || !fields.procedure || !fields.amount) {
      return res.status(400).json({ error: "reference_number, date, procedure and amount are required" });
    }

    const { data, error } = await supabase
      .from("invoices")
      .insert(fields)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, invoice: data });
  }

  // ── PUT — mark paid/unpaid ────────────────────────────────────────────────
  if (req.method === "PUT") {
    if (!body.id) return res.status(400).json({ error: "id is required" });

    const { data, error } = await supabase
      .from("invoices")
      .update({ paid: body.paid })
      .eq("id", body.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, invoice: data });
  }

  // ── DELETE — remove invoice ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!body.id) return res.status(400).json({ error: "id is required" });

    const { error } = await supabase
      .from("invoices")
      .delete()
      .eq("id", body.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
