"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const reviews = new Map();

let telegramOffset = 0;
let polling = false;

const stageNames = {
  pin_demo: "Sample PIN Demo",
  otp1_demo: "Sample SMS Demo",
  otp2_demo: "Sample Code Demo"
};

async function telegram(method, payload = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ${method} failed.`);
  }

  return result.result;
}

/* Create a demo review and send the Telegram buttons. */
app.post("/api/demo-status", async (req, res) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({
        success: false,
        error: "Telegram environment variables are missing."
      });
    }

    const stage = req.body?.stage;

    if (!Object.prototype.hasOwnProperty.call(stageNames, stage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid demo stage."
      });
    }

    const reference = crypto.randomBytes(8).toString("hex").toUpperCase();

    reviews.set(reference, {
      reference,
      stage,
      status: "pending",
      createdAt: Date.now()
    });

    await telegram("sendMessage", {
      chat_id: CHAT_ID,
      text:
        "🧪 DEMO REVIEW REQUEST\n\n" +
        `Stage: ${stageNames[stage]}\n` +
        `Reference: ${reference}\n` +
        "Status: Pending\n\n" +
        "Fictional demonstration only. No PIN or OTP was transmitted.",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Approve Demo",
              callback_data: `approve:${reference}`
            },
            {
              text: "❌ Decline Demo",
              callback_data: `decline:${reference}`
            }
          ]
        ]
      }
    });

    return res.json({
      success: true,
      reference,
      status: "pending"
    });
  } catch (error) {
    console.error("Create review error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not create demo review."
    });
  }
});

/* Website polls this endpoint for the review decision. */
app.get("/api/demo-status/:reference", (req, res) => {
  const review = reviews.get(req.params.reference);

  if (!review) {
    return res.status(404).json({
      success: false,
      error: "Demo review not found."
    });
  }

  return res.json({
    success: true,
    reference: review.reference,
    stage: review.stage,
    status: review.status
  });
});

/* Handle Approve Demo and Decline Demo button taps. */
async function handleCallback(callback) {
  const callbackId = callback.id;
  const data = callback.data || "";

  const match = /^(approve|decline):([A-F0-9]+)$/i.exec(data);

  if (!match) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "Unknown demo action."
    });
    return;
  }

  const action = match[1].toLowerCase();
  const reference = match[2];
  const review = reviews.get(reference);

  if (!review) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "Demo request expired or server restarted."
    });
    return;
  }

  if (review.status !== "pending") {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: `Already ${review.status}.`
    });
    return;
  }

  review.status = action === "approve" ? "approved" : "declined";
  review.decidedAt = Date.now();

  await telegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    text: review.status === "approved"
      ? "Demo approved."
      : "Demo declined."
  });

  const message = callback.message;

  if (message) {
    try {
      await telegram("editMessageText", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text:
          `${message.text || "Demo review"}\n\n` +
          `Decision: ${
            review.status === "approved"
              ? "✅ APPROVED"
              : "❌ DECLINED"
          }`,
        reply_markup: {
          inline_keyboard: []
        }
      });
    } catch (error) {
      console.error("Telegram message update error:", error.message);
    }
  }

  console.log(`Review ${reference}: ${review.status}`);
}

/* Only one running process should poll this bot. */
async function pollTelegram() {
  if (polling || !BOT_TOKEN) return;

  polling = true;
  console.log("Telegram demo polling started.");

  while (polling) {
    try {
      const updates = await telegram("getUpdates", {
        offset: telegramOffset,
        timeout: 25,
        allowed_updates: ["callback_query"]
      });

      for (const update of updates) {
        telegramOffset = update.update_id + 1;

        if (update.callback_query) {
          try {
            await handleCallback(update.callback_query);
          } catch (error) {
            console.error("Callback error:", error.message);
          }
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);

      if (error.message.includes("Conflict")) {
        console.error(
          "Another instance is polling this bot. Stop that instance before restarting this server."
        );
        polling = false;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error(
      "Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render."
    );
    return;
  }

  pollTelegram();
});
