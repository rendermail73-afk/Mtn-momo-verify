const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse incoming requests.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Telegram configuration from Render environment variables.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// In-memory storage for demo approval status.
const demoStatuses = new Map();

// Prevent repeated handling of the same Telegram callback.
const processedCallbacks = new Set();

// Telegram API helper.
async function telegramRequest(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error(
      "Telegram is not configured. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    );
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

// Health-check endpoint.
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Demo server is running"
  });
});

// Create a demo event and send it to Telegram.
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
      `DEMO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const record = {
      status: "pending",
      stage,
      createdAt: new Date().toISOString(),
      messageId: null,
      chatId: CHAT_ID || null
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
      "No PINs, OTPs, or private SMS contents are included."
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
      console.log(
        "Telegram is not configured. Demo event:",
        message
      );
    }

    return res.json({
      success: true,
      reference,
      status: record.status,
      stage: record.stage
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

// Check a demo event's current status.
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
    reference: req.params.reference,
    status: record.status,
    stage: record.stage
  });
});

// Handle a Telegram button press.
async function processCallback(callback) {
  if (!callback || !callback.id) {
    return;
  }

  if (processedCallbacks.has(callback.id)) {
    return;
  }

  processedCallbacks.add(callback.id);

  const callbackMessage = callback.message;
  const callbackChatId = callbackMessage?.chat?.id;

  // Only accept decisions from the configured Telegram chat.
  if (
    !callbackChatId ||
    String(callbackChatId) !== String(CHAT_ID)
  ) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "This demo is not authorized for this chat."
    });

    return;
  }

  const parts = String(callback.data || "").split(":");
  const action = parts[0];
  const reference = parts.slice(1).join(":");

  if (
    !["approve", "decline"].includes(action) ||
    !demoStatuses.has(reference)
  ) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "This demo request is unavailable."
    });

    return;
  }

  const record = demoStatuses.get(reference);

  if (record.status !== "pending") {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: `Already ${record.status}.`
    });

    return;
  }

  record.status =
    action === "approve" ? "approved" : "declined";

  record.decidedAt = new Date().toISOString();

  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callback.id,
    text:
      action === "approve"
        ? "Demo approved"
        : "Demo declined"
  });

  const originalText =
    callbackMessage.text || "Demo verification event";

  // Remove the buttons after a decision is made.
  await telegramRequest("editMessageText", {
    chat_id: callbackChatId,
    message_id: callbackMessage.message_id,
    text:
      `${originalText}\n\n` +
      `Result: ${record.status.toUpperCase()}\n` +
      `Decision time: ${record.decidedAt}`,
    reply_markup: {
      inline_keyboard: []
    }
  });

  console.log(
    `Demo ${reference} was ${record.status}.`
  );
}

// Poll Telegram for inline-button callbacks.
async function handleTelegramUpdates() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log(
      "Telegram polling disabled: configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    );
    return;
  }

  let offset = 0;

  console.log("Starting Telegram update polling...");

  while (true) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}&allowed_updates=%5B%22callback_query%22%5D`
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.description || "Telegram update request failed"
        );
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        if (!update.callback_query) {
          continue;
        }

        try {
          await processCallback(update.callback_query);
        } catch (error) {
          console.error(
            "Could not process Telegram button:",
            error.message
          );
        }
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

// Serve the frontend from the repository root.
app.use(express.static(__dirname));

// Express 5-compatible fallback route.
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
