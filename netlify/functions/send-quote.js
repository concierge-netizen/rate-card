// ──────────────────────────────────────────────────────────────
// HANDS Logistics — Send Quote via Resend
// Netlify Function (runs server-side)
// ──────────────────────────────────────────────────────────────
//
// Env vars required (set in Netlify dashboard):
//   RESEND_API_KEY   — your Resend API key (starts with re_...)
//
// Endpoint: POST /.netlify/functions/send-quote
// Body: { to, subject, body }
// ──────────────────────────────────────────────────────────────

const FROM_ADDRESS = "HANDS Logistics <concierge@handslogistics.com>";
const REPLY_TO = "concierge@handslogistics.com";

exports.handler = async (event) => {
  // ── CORS / METHOD CHECK ──
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  // ── API KEY CHECK ──
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "RESEND_API_KEY not configured. Add it in Netlify → Site settings → Environment variables."
      })
    };
  }

  // ── PARSE BODY ──
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  const { to, subject, body } = payload;

  // ── VALIDATE ──
  if (!to || !to.includes("@")) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Valid recipient email required" })
    };
  }
  if (!subject || subject.trim().length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Subject required" })
    };
  }
  if (!body || body.trim().length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Email body required" })
    };
  }

  // ── CONVERT PLAIN TEXT BODY TO HTML ──
  // Preserve line breaks and make it render cleanly in email clients
  const htmlBody = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111110; line-height: 1.6; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff; }
  pre { font-family: inherit; white-space: pre-wrap; word-wrap: break-word; margin: 0; font-size: 15px; }
</style>
</head>
<body>
<pre>${escapeHtml(body)}</pre>
</body>
</html>`;

  // ── SEND VIA RESEND ──
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        reply_to: REPLY_TO,
        subject: subject,
        html: htmlBody,
        text: body   // plain text fallback for email clients that prefer it
      })
    });

    const result = await response.json();

    if (!response.ok) {
      // Resend returns error details in the response body
      console.error("Resend API error:", result);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: result.message || result.error || "Resend rejected the send",
          details: result
        })
      };
    }

    // Success
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: result.id,
        to: to
      })
    };

  } catch (err) {
    console.error("Send failed:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Network or server error: " + err.message
      })
    };
  }
};

// ── HELPERS ──
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
