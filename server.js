const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const demoStatuses = new Map();

async function telegramRequest(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("Telegram environment variables are not configured.");
    return null;
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
    throw new Error(result.description || "Telegram request failed");
  }

  return result;
}

// Send a demo-stage notification to Telegram.
app.post("/api/demo-status", async (req, res) => {
  try {
    const allowedStages = [
      "phone_demo",
      "pin_demo",
      "otp1_demo",
      "otp2_demo",
      "completed"
    ];

    const stage = req.body.stage;

    if (!allowedStages.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid demo stage"
      });
    }

    const reference =
      `DEMO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    demoStatuses.set(reference, {
      status: "pending",
      stage
    });

    const message = [
      "🧪 DEMO VERIFICATION EVENT",
      "",
      `Reference: ${reference}`,
      `Stage: ${stage}`,
      `Time: ${new Date().toISOString()}`,
      "",
      "This is a demonstration event.",
      "No PIN or OTP values are included."
    ].join("\n");

    if (BOT_TOKEN && CHAT_ID) {
      const result = await telegramRequest("sendMessage", {
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

      // Store the Telegram message ID for later status updates.
      const saved = demoStatuses.get(reference);
      if (saved) {
        saved.messageId = result.result.message_id;
      }
    } else {
      console.log("Demo event:", message);
    }

    return res.json({
      success: true,
      reference,
      status: "pending"
    });
  } catch (error) {
    console.error("Demo notification failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Unable to send demo notification"
    });
  }
});

// Check the result of a demo approval.
app.get("/api/demo-status/:reference", (req, res) => {
  const item = demoStatuses.get(req.params.reference);

  if (!item) {
    return res.status(404).json({
      success: false,
      error: "Demo reference not found"
    });
  }

  return res.json({
    success: true,
    status: item.status,
    stage: item.stage
  });
});

// Telegram callback handling.
async function handleTelegramUpdates() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("Telegram polling disabled: configure bot token and chat ID.");
    return;
  }

  let offset = 0;

  while (true) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`
      );

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.description || "getUpdates failed");
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        const callback = update.callback_query;
        if (!callback) continue;

        // Only accept button presses from the configured Telegram chat.
        if (
          !callback.message ||
          String(callback.message.chat.id) !== String(CHAT_ID)
        ) {
          await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo is not authorized for this chat."
          });
          continue;
        }

        const [action, reference] =
          String(callback.data || "").split(":");

        if (
          !["approve", "decline"].includes(action) ||
          !demoStatuses.has(reference)
        ) {
          await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo request is no longer available."
          });
          continue;
        }

        const item = demoStatuses.get(reference);

        item.status = action === "approve" ? "approved" : "declined";

        await telegramRequest("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: action === "approve"
            ? "Demo approved"
            : "Demo declined"
        });

        const originalText =
          callback.message.text || "Demo verification event";

        await telegramRequest("editMessageText", {
          chat_id: CHAT_ID,
          message_id: callback.message.message_id,
          text:
            `${originalText}\n\n` +
            `Result: ${item.status.toUpperCase()}`
        });
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Serve static demo files.
app.use(express.static(path.join(__dirname, "public")));

// Express 5-compatible fallback route.
// Do not use app.get("*", ...) with Express 5.
app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 500)
          .send("Unable to load the demo page.");
      }
    }
  );
});

app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  handleTelegramUpdates();
});
