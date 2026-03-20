/**
 * /api/manage.js
 * Create, update, and delete Google Calendar events from the staff dashboard.
 *
 * POST   /api/manage  { action: "create", token, password, name, phone, email, date, time, description }
 * PUT    /api/manage  { action: "update", token, password, eventId, description }
 * DELETE /api/manage  { action: "delete", token, password, eventId }
 */

const { google } = require("googleapis");

const TIMEZONE    = "Africa/Accra";
const CLINIC_NAME = "Rivers Dental Clinic";
const CLINIC_ADDR = "Tantra Street, Taifa, Accra (Opposite GOIL Filling Station)";

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

function auth(body) {
  return body.token === process.env.DASHBOARD_TOKEN &&
         body.password === process.env.DASHBOARD_PASSWORD;
}

// ─── Create event ─────────────────────────────────────────────────────────────
async function createEvent(calendarApi, { name, phone, email, date, time, description }) {
  // date = "YYYY-MM-DD", time = "HH:MM" (24hr)
  const startIso = `${date}T${time}:00Z`;
  const startDt  = new Date(startIso);
  const endDt    = new Date(startDt.getTime() + 60 * 60 * 1000); // default 1hr

  const desc = [
    `Patient: ${name}`,
    `Phone: ${phone}`,
    email ? `Email: ${email}` : null,
    description ? `\n${description}` : null,
  ].filter(Boolean).join("\n");

  const event = {
    summary: name,
    description: desc,
    location: CLINIC_ADDR,
    start: { dateTime: startDt.toISOString(), timeZone: TIMEZONE },
    end:   { dateTime: endDt.toISOString(),   timeZone: TIMEZONE },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  };

  const res = await calendarApi.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: event,
  });
  return res.data;
}

// ─── Update event notes ───────────────────────────────────────────────────────
async function updateEvent(calendarApi, { eventId, description }) {
  // Fetch existing event first
  const existing = await calendarApi.events.get({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
  });
  const event = existing.data;

  // Preserve structured fields (Patient, Phone, Email, Service) and replace notes
  const lines = (event.description || "").split("\n");
  const structuredLines = lines.filter(l =>
    l.startsWith("Patient:") || l.startsWith("Phone:") ||
    l.startsWith("Email:")   || l.startsWith("Service:") ||
    l.startsWith("Booked via:")
  );

  const newDesc = structuredLines.length > 0
    ? structuredLines.join("\n") + (description ? `\n\n${description}` : "")
    : description;

  const res = await calendarApi.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
    requestBody: { description: newDesc },
  });
  return res.data;
}

// ─── Delete event ─────────────────────────────────────────────────────────────
async function deleteEvent(calendarApi, { eventId }) {
  await calendarApi.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId,
  });
  return { deleted: true };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  if (!auth(body)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const authClient  = getAuthClient();
    const calendarApi = google.calendar({ version: "v3", auth: authClient });

    let result;
    if (req.method === "POST")   result = await createEvent(calendarApi, body);
    if (req.method === "PUT")    result = await updateEvent(calendarApi, body);
    if (req.method === "DELETE") result = await deleteEvent(calendarApi, body);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("[manage] Error:", err.message);
    return res.status(500).json({ error: err.message || "Failed to manage appointment." });
  }
};
