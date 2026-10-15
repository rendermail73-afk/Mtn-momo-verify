const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Demo requests are stored in memory.
const reviews = new Map();

const allowedStages = [
  "demo_step_1",
  "demo_step_2",
  "demo_step_3"
];

const stageNames = {
  demo_step_1: "Demo step 1",
  demo_step_2: "Demo step 2",
  demo_step_3: "Demo step 3"
};

function makeReference() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function telegram(method, body = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description || "Telegram API request failed."
    );
  }

  return result.result;
}

// Create a demo review.
// No phone numbers, PINs, passwords, or verification codes are accepted.
app.post("/api/demo-status", async (req, res) => {
  const stage = req.body?.stage;

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      error: "Invalid demo stage."
    });
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({
      error: "Telegram bot configuration is missing."
    });
  }

  const reference = makeReference();

  reviews.set(reference, {
    stage,
    status: "pending",
    createdAt: Date.now()
  });

  const message = [
    "🟡 DEMO REVIEW REQUEST",
    "",
    "This is a simulated demonstration.",
    "No financial credentials were collected.",
    "",
    `Reference: ${reference}`,
    `Stage: ${stageNames[stage]}`,
    "",
    "Choose an action below."
  ].join("\n");

  try {
    await telegram("sendMessage", {
      chat_id: CHAT_ID,
      text: message,
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
    reviews.delete(reference);

    console.error("Telegram send error:", error.message);

    return res.status(502).json({
      error: "Unable to send the demo request to Telegram."
    });
  }
});

// Check the status of a demo request.
app.get("/api/demo-status/:reference", (req, res) => {
  const reference = req.params.reference;
  const review = reviews.get(reference);

  if (!review) {
    return res.status(404).json({
      error: "Demo request not found."
    });
  }

  return res.json({
    reference,
    stage: review.stage,
    status: review.status
  });
});

// Process Telegram inline-button clicks.
async function handleCallback(callback) {
  const callbackId = callback.id;
  const data = callback.data || "";
  const message = callback.message;

  const parts = data.split(":");
  const action = parts[0];
  const reference = parts[1];

  if (
    !["approve", "decline"].includes(action) ||
    !reference
  ) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "Invalid demo action."
    });

    return;
  }

  const review = reviews.get(reference);

  if (!review) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "This demo request has expired or is unavailable."
    });

    return;
  }

  if (review.status !== "pending") {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "This request has already been reviewed."
    });

    return;
  }

  review.status = action === "approve" ? "approved" : "declined";
  review.reviewedAt = Date.now();

  const resultText =
    action === "approve"
      ? "✅ DEMO APPROVED"
      : "❌ DEMO DECLINED";

  await telegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    text: resultText
  });

  if (message) {
    try {
      await telegram("editMessageText", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: [
          "🟡 DEMO REVIEW RESULT",
          "",
          resultText,
          `Reference: ${reference}`,
          `Stage: ${stageNames[review.stage]}`,
          "",
          action === "approve"
            ? "The demo may continue to its next simulated step."
            : "The demo should return to the affected step."
        ].join("\n")
      });
    } catch (error) {
      console.error(
        "Telegram message update error:",
        error.message
      );
    }
  }
}

// Only one running server instance should poll this bot.
let polling = false;
let pollingOffset = 0;

async function startTelegramPolling() {
  if (polling || !BOT_TOKEN) {
    return;
  }

  polling = true;

  console.log("Telegram demo polling started.");

  while (polling) {
    try {
      const updates = await telegram("getUpdates", {
        offset: pollingOffset,
        timeout: 25,
        allowed_updates: ["callback_query"]
      });

      for (const update of updates) {
        pollingOffset = update.update_id + 1;

        if (update.callback_query) {
          try {
            await handleCallback(update.callback_query);
          } catch (error) {
            console.error(
              "Telegram button error:",
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

      // A conflict usually means another server is polling
      // the same bot. Stop rather than repeatedly competing.
      if (
        error.message &&
        error.message.toLowerCase().includes("conflict")
      ) {
        console.error(
          "Stop the other running bot instance before restarting."
        );

        polling = false;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Demo approval server"
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn(
      "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your hosting environment."
    );
  } else {
    startTelegramPolling();
  }
});
