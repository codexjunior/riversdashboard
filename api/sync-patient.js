/**
 * /api/sync-patient.js
 * Called by Google Apps Script when a patient form is submitted.
 * Creates or updates the patient record in Supabase.
 *
 * POST /api/sync-patient
 * { sync_token, reference_number, timestamp, gender, age_category,
 *   phone, whatsapp, birthdate, email, city, company, profession,
 *   emergency_contact_name, emergency_contact_relation, emergency_contact_phone }
 */

const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  // Verify sync token — separate from dashboard password for security
  if (body.sync_token !== process.env.SYNC_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!body.reference_number) {
    return res.status(400).json({ error: "reference_number is required" });
  }

  const supabase = getSupabase();

  const patient = {
    reference_number:          body.reference_number,
    name:                      body.name               || null,
    gender:                    body.gender             !== undefined ? body.gender : null,
    age_category:              body.age_category       !== undefined ? body.age_category : null,
    phone:                     body.phone              || null,
    whatsapp:                  body.whatsapp           || null,
    birthdate:                 body.birthdate          || null,
    email:                     body.email              || null,
    city:                      body.city               || null,
    company:                   body.company            || null,
    profession:                body.profession         || null,
    emergency_contact_name:    body.emergency_contact_name     || null,
    emergency_contact_relation: body.emergency_contact_relation || null,
    emergency_contact_phone:   body.emergency_contact_phone    || null,
  };

  const { data, error } = await supabase
    .from("patients")
    .upsert(patient, { onConflict: "reference_number" })
    .select()
    .single();

  if (error) {
    console.error("[sync-patient] Supabase error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, patient: data });
};
