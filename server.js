const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Telegram configuration from Render environment variables.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// In-memory storage for demo approval status.
const demoStatuses = new Map();

async function telegramRequest(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log(
      "Telegram is not configured. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    );
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
    throw new Error(
      result.description || "Telegram request failed"
    );
  }

  return result;
}

// Receive a demo-stage event and notify Telegram.
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

    const record = {
      status: "pending",
      stage,
      createdAt: new Date().toISOString(),
      messageId: null
    };

    demoStatuses.set(reference, record);

    const message = [
      "🧪 DEMO VERIFICATION EVENT",
      "",
      `Reference: ${reference}`,
      `Stage: ${stage}`,
      `Time: ${record.createdAt}`,
      "",
      "Demonstration only.",
      "No PINs or OTP values are included."
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

      record.messageId = result.result.message_id;
    } else {
      console.log(message);
    }

    return res.json({
      success: true,
      reference,
      status: record.status
    });
  } catch (error) {
    console.error(
      "Demo notification error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      error: "Unable to send demo notification"
    });
  }
});

// Return the current demo decision.
app.get("/api/demo-status/:reference", (req, res) => {
  const record = demoStatuses.get(req.params.reference);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: "Demo reference not found"
    });
  }

  return res.json({
    success: true,
    status: record.status,
    stage: record.stage
  });
});

// Listen for Telegram inline-button presses.
async function handleTelegramUpdates() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log(
      "Telegram polling disabled: configure the environment variables."
    );
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
        throw new Error(
          data.description || "Telegram update request failed"
        );
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        const callback = update.callback_query;

        if (!callback) {
          continue;
        }

        const chatId = callback.message?.chat?.id;

        // Only accept button presses from the configured chat.
        if (String(chatId) !== String(CHAT_ID)) {
          await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo is not authorized for this chat."
          });

          continue;
        }

        const parts = String(callback.data || "").split(":");
        const action = parts[0];
        const reference = parts[1];

        if (
          !["approve", "decline"].includes(action) ||
          !demoStatuses.has(reference)
        ) {
          await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo request is unavailable."
          });

          continue;
        }

        const record = demoStatuses.get(reference);

        record.status =
          action === "approve" ? "approved" : "declined";

        await telegramRequest("answerCallbackQuery", {
          callback_query_id: callback.id,
          text:
            action === "approve"
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
            `Result: ${record.status.toUpperCase()}`
        });
      }
    } catch (error) {
      console.error(
        "Telegram polling error:",
        error.message
      );

      await new Promise(resolve =>
        setTimeout(resolve, 5000)
      );
    }
  }
}

// Serve the frontend files from the repository root.
app.use(express.static(__dirname));

// Express 5-compatible fallback route.
// This avoids the invalid app.get("*", ...) pattern.
app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(
    path.join(__dirname, "index.html"),
    error => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 500).send(
          "Unable to load the demo page. Check that index.html exists."
        );
      }
    }
  );
});

// Start the server.
app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  handleTelegramUpdates();
});
