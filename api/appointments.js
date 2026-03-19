/**
 * /api/appointments.js
 * Returns all upcoming appointments from Google Calendar.
 * Protected by a secret token and dashboard password.
 *
 * GET /api/appointments?token=SECRET_URL_TOKEN&password=DASHBOARD_PASSWORD
 */

const { google } = require("googleapis");

const TIMEZONE = "Africa/Accra";

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
}

function parseDescription(description) {
  if (!description) return {};
  const get = (key) => {
    const match = description.match(new RegExp(`${key}: (.+)`));
    return match ? match[1].trim() : "—";
  };
  return {
    patient: get("Patient"),
    service: get("Service"),
    email:   get("Email"),
    phone:   get("Phone"),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify secret URL token
  if (req.query.token !== process.env.DASHBOARD_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Verify dashboard password
  if (req.query.password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(403).json({ error: "Invalid password" });
  }

  try {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date().toISOString();

    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: now,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const events = (response.data.items || []).map((event) => {
      const start = new Date(event.start.dateTime || event.start.date);
      const details = parseDescription(event.description);

      return {
        id: event.id,
        title: event.summary || "",
        patient: details.patient,
        service: details.service,
        email: details.email,
        phone: details.phone,
        date: start.toLocaleDateString("en-GH", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          timeZone: TIMEZONE,
        }),
        time: start.toLocaleTimeString("en-GH", {
          hour: "2-digit", minute: "2-digit", hour12: true,
          timeZone: TIMEZONE,
        }),
        dateRaw: start.toISOString(),
      };
    });

    return res.status(200).json({ appointments: events, total: events.length });

  } catch (err) {
    console.error("[appointments] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch appointments." });
  }
};
