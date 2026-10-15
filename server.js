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
  otp1_demo: "Sample Message Demo",
  otp2_demo: "Sample Four-Digit Code Demo"
};

async function telegram(method, payload = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description || `Telegram ${method} failed.`
    );
  }

  return result.result;
}

/*
 * Create a demo review.
 * No phone number, PIN, or OTP is accepted by this endpoint.
 */
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

    const reference = crypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase();

    reviews.set(reference, {
      reference,
      stage,
      status: "pending",
      createdAt: Date.now()
    });

    await telegram("sendMessage", {
      chat_id: CHAT_ID,

      text:
        "🧪 MOMO DEMO REVIEW\n\n" +
        `Stage: ${stageNames[stage]}\n` +
        `Reference: ${reference}\n` +
        "Status: Pending\n\n" +
        "Demo only. No PIN, OTP, or personal details were sent.",

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

/* Website checks this endpoint for the decision. */
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

/* Process Telegram inline-button taps. */
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
      text: "Demo expired. Start a new demo."
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

  review.status =
    action === "approve" ? "approved" : "declined";

  review.decidedAt = Date.now();

  await telegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    text:
      review.status === "approved"
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
      console.error(
        "Telegram message update error:",
        error.message
      );
    }
  }

  console.log(
    `Demo ${reference}: ${review.status}`
  );
}

/*
 * Telegram polling.
 * Run only ONE instance of this server for this bot token.
 */
async function pollTelegram() {
  if (polling || !BOT_TOKEN) {
    return;
  }

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
            console.error(
              "Callback error:",
              error.message
            );
          }
        }
      }
    } catch (error) {
      console.error(
        "Telegram polling error:",
        error.message
      );

      if (error.message.includes("Conflict")) {
        console.error(
          "Another process is polling this bot. Stop the other process."
        );

        polling = false;
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );
    }
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error(
      "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    );

    return;
  }

  pollTelegram();
});
