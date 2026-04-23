// ───────────────────────────────────────────────────────────────
// HANDS Logistics — Proposals API
// Handles: create, read, list, accept, request-changes
// Persistence: Netlify Blobs (built-in, no extra setup)
// ───────────────────────────────────────────────────────────────
//
// Routes (all POST):
//   action=save              → save proposal, returns slug
//   action=load  + slug      → fetch proposal data
//   action=list              → list all proposals (admin only, requires password)
//   action=accept + slug     → mark accepted, email Jon
//   action=changes + slug    → send change request, email Jon
//
// Env vars required in Netlify:
//   RESEND_API_KEY       — for notification emails to Jon
//   ADMIN_PASSWORD       — for list/admin operations
// ───────────────────────────────────────────────────────────────

const { getStore } = require("@netlify/blobs");

const FROM_ADDRESS = "HANDS Logistics <concierge@handslogistics.com>";
const JON_EMAIL = "concierge@handslogistics.com";

exports.handler = async (event) => {
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
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action } = payload;
  const store = getStore("proposals");

  try {
    if (action === "save") {
      return await handleSave(payload, store, headers);
    }
    if (action === "load") {
      return await handleLoad(payload, store, headers);
    }
    if (action === "list") {
      return await handleList(payload, store, headers);
    }
    if (action === "accept") {
      return await handleAccept(payload, store, headers);
    }
    if (action === "changes") {
      return await handleChanges(payload, store, headers);
    }
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Unknown action: " + action })
    };
  } catch (err) {
    console.error("Proposal handler error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Server error" })
    };
  }
};

// ── SAVE: admin creates/updates a proposal ──
async function handleSave(payload, store, headers) {
  const { password, proposal } = payload;
  if (!checkAdmin(password)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  if (!proposal || !proposal.client) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing proposal data" }) };
  }

  // Generate slug from client name + date if new, keep existing slug on update
  const slug = proposal.slug || makeSlug(proposal.client);
  const now = new Date().toISOString();

  const record = {
    slug,
    client: proposal.client || "",
    contact: proposal.contact || "",
    email: proposal.email || "",
    onboardingIntro: proposal.onboardingIntro || "",
    storageItems: proposal.storageItems || [],
    deliveryItems: proposal.deliveryItems || [],
    customNotes: proposal.customNotes || "",
    createdAt: proposal.createdAt || now,
    updatedAt: now,
    status: proposal.status || "sent"
  };

  await store.setJSON(slug, record);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, slug, proposal: record })
  };
}

// ── LOAD: public route — client fetches their proposal ──
async function handleLoad(payload, store, headers) {
  const { slug } = payload;
  if (!slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "slug required" }) };
  }
  const record = await store.get(slug, { type: "json" });
  if (!record) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Proposal not found" }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposal: record }) };
}

// ── LIST: admin only ──
async function handleList(payload, store, headers) {
  const { password } = payload;
  if (!checkAdmin(password)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const { blobs } = await store.list();
  const proposals = [];
  for (const blob of blobs) {
    const record = await store.get(blob.key, { type: "json" });
    if (record) proposals.push(record);
  }
  // Most recent first
  proposals.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposals }) };
}

// ── ACCEPT: client clicks Accept on their proposal ──
async function handleAccept(payload, store, headers) {
  const { slug } = payload;
  if (!slug) return { statusCode: 400, headers, body: JSON.stringify({ error: "slug required" }) };

  const record = await store.get(slug, { type: "json" });
  if (!record) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

  record.status = "accepted";
  record.acceptedAt = new Date().toISOString();
  await store.setJSON(slug, record);

  // Notify Jon
  await sendNotification({
    subject: `✓ ACCEPTED — ${record.client}`,
    body: buildAcceptNotification(record)
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

// ── REQUEST CHANGES: client sends feedback ──
async function handleChanges(payload, store, headers) {
  const { slug, notes } = payload;
  if (!slug) return { statusCode: 400, headers, body: JSON.stringify({ error: "slug required" }) };

  const record = await store.get(slug, { type: "json" });
  if (!record) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

  record.status = "changes_requested";
  record.lastChangeRequest = {
    at: new Date().toISOString(),
    notes: notes || ""
  };
  await store.setJSON(slug, record);

  await sendNotification({
    subject: `↩ CHANGES REQUESTED — ${record.client}`,
    body: buildChangeRequestNotification(record, notes)
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
}

// ── HELPERS ──
function checkAdmin(password) {
  // Temporarily hardcoded for diagnostic purposes.
  // TODO: revert to process.env.ADMIN_PASSWORD once login flow confirmed working.
  const expected = "HANDS2026";
  return password === expected;
}

function getSiteUrl() {
  // Netlify sets URL automatically to the production site URL,
  // and DEPLOY_PRIME_URL for branch/preview deploys. Falls back
  // to a sensible default if neither is set (local dev).
  return process.env.URL || process.env.DEPLOY_PRIME_URL || "https://hqrates.netlify.app";
}

function makeSlug(client) {
  const base = (client || "proposal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
  // Append short timestamp to prevent collisions
  const stamp = Date.now().toString(36).slice(-5);
  return `${base}-${stamp}`;
}

async function sendNotification({ subject, body }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping notification");
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [JON_EMAIL],
        subject,
        text: body,
        html: `<pre style="font-family: -apple-system, sans-serif; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${escapeHtml(body)}</pre>`
      })
    });
  } catch (e) {
    console.error("Notification send failed:", e);
  }
}

function buildAcceptNotification(record) {
  const url = `${getSiteUrl()}/proposal/${record.slug}`;
  let body = `Good news — ${record.client} accepted their proposal.\n\n`;
  body += `Client:   ${record.client}\n`;
  body += `Contact:  ${record.contact || "(not provided)"}\n`;
  body += `Email:    ${record.email || "(not provided)"}\n`;
  body += `Slug:     ${record.slug}\n`;
  body += `Accepted: ${record.acceptedAt}\n\n`;
  body += `View:  ${url}\n\n`;
  body += `Next: reach out to confirm start date and kick off onboarding.`;
  return body;
}

function buildChangeRequestNotification(record, notes) {
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/proposal/${record.slug}`;
  let body = `${record.client} requested changes to their proposal.\n\n`;
  body += `Client:   ${record.client}\n`;
  body += `Contact:  ${record.contact || "(not provided)"}\n`;
  body += `Email:    ${record.email || "(not provided)"}\n`;
  body += `Slug:     ${record.slug}\n\n`;
  body += `Their notes:\n`;
  body += `────────────────────────\n`;
  body += `${notes || "(no notes provided)"}\n`;
  body += `────────────────────────\n\n`;
  body += `View/edit:  ${url}\n`;
  body += `Admin:      ${siteUrl}/admin\n`;
  return body;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
