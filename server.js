const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const reviews = new Map();
let nextUpdateOffset = 0;
let pollingStarted = false;

async function telegram(method, payload = {}) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error (${response.status})`);
  }
  return data.result;
}

function makeRef() {
  return `DEMO-${Date.now().toString().slice(-8)}`;
}

// Only a stage label is accepted from the browser. User-entered values are deliberately ignored.
app.post("/api/demo-status", async (req, res) => {
  const allowed = new Set(["number-stage", "pin-stage", "otp1-stage", "otp2-stage"]);
  const stage = typeof req.body?.stage === "string" ? req.body.stage : "";
  if (!allowed.has(stage)) return res.status(400).json({ ok: false, error: "Unknown demo stage" });

  const ref = makeRef();
  reviews.set(ref, { status: "pending", stage, createdAt: Date.now() });

  if (BOT_TOKEN && CHAT_ID) {
    try {
      await telegram("sendMessage", {
        chat_id: CHAT_ID,
        text:
          `🧪 DEMO REVIEW REQUEST\n` +
          `Reference: ${ref}\n` +
          `Stage: ${stage}\n` +
          `Demo number: 0700000000 (predefined sample)\n` +
          `Demo PIN: 12345 (predefined sample)\n` +
          `OTP 1 message: "Demo message: DEMO-482736" (predefined sample)\n` +
          `OTP 2 code: 222222 (predefined sample)\n\n` +
          `These are synthetic examples, not values entered by a visitor.`,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve Demo", callback_data: `approve:${ref}` },
            { text: "❌ Decline Demo", callback_data: `decline:${ref}` }
          ]]
        }
      });
    } catch (err) {
      console.error("Telegram send failed:", err.message);
      return res.status(502).json({ ok: false, error: "Could not send Telegram demo notification" });
    }
  }

  res.json({ ok: true, reference: ref, status: "pending" });
});

app.get("/api/review-status/:ref", (req, res) => {
  const record = reviews.get(req.params.ref);
  if (!record) return res.status(404).json({ ok: false, error: "Unknown demo reference" });
  res.json({ ok: true, status: record.status });
});

// Telegram inline keyboard callback processing via long polling.
async function pollTelegram() {
  if (!BOT_TOKEN || pollingStarted) return;
  pollingStarted = true;

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset: nextUpdateOffset,
        timeout: 25,
        allowed_updates: ["callback_query"]
      });

      for (const update of updates) {
        nextUpdateOffset = update.update_id + 1;
        const callback = update.callback_query;
        if (!callback || !callback.data) continue;

        const match = /^(approve|decline):(DEMO-\d+)$/.exec(callback.data);
        if (!match) {
          await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Unknown demo action"
          }).catch(() => {});
          continue;
        }

        const [, action, ref] = match;
        const record = reviews.get(ref);
        if (record) {
          record.status = action === "approve" ? "approved" : "declined";
          reviews.set(ref, record);
        }

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: action === "approve" ? "Demo approved" : "Demo declined"
        }).catch(() => {});

        if (callback.message) {
          await telegram("editMessageReplyMarkup", {
            chat_id: callback.message.chat.id,
            message_id: callback.message.message_id,
            reply_markup: { inline_keyboard: [] }
          }).catch(() => {});
          await telegram("sendMessage", {
            chat_id: callback.message.chat.id,
            text: `Demo ${ref}: ${action === "approve" ? "APPROVED" : "DECLINED"}`
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Telegram polling error:", err.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo server listening on ${PORT}`);
  pollTelegram();
});
