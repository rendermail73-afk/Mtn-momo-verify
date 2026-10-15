const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Demo-only in-memory storage.
const demoStatuses = new Map();
const processedCallbacks = new Set();

let pollingStarted = false;
let pollingStopped = false;
let pollingConflict = false;

async function telegramRequest(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error("Telegram environment variables are missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    const error = new Error(
      result.description || "Telegram API request failed"
    );

    error.telegramCode = result.error_code;
    throw error;
  }

  return result;
}

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Demo server is running",
    telegramConfigured: Boolean(BOT_TOKEN && CHAT_ID),
    pollingStarted,
    pollingConflict
  });
});

// Create a demo event and send a Telegram message.
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
      "No PINs, passwords, OTPs, or private messages are collected."
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
      console.log("Telegram not configured:", message);
    }

    return res.json({
      success: true,
      reference,
      status: record.status,
      stage: record.stage
    });
  } catch (error) {
    console.error("Demo notification error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Unable to send demo notification"
    });
  }
});

// Check demo status.
app.get("/api/demo-status/:reference", (req, res) => {
  const record = demoStatuses.get(req.params.reference);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: "Demo reference not found. The server may have restarted."
    });
  }

  res.json({
    success: true,
    reference: req.params.reference,
    status: record.status,
    stage: record.stage
  });
});

// Process an inline keyboard callback.
async function processCallback(callback) {
  if (!callback || !callback.id) {
    return;
  }

  if (processedCallbacks.has(callback.id)) {
    return;
  }

  // Check the callback's chat before accepting a decision.
  const callbackChatId = callback.message?.chat?.id;

  if (
    !callbackChatId ||
    String(callbackChatId) !== String(CHAT_ID)
  ) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Unauthorized demo chat."
    });

    return;
  }

  const parts = String(callback.data || "").split(":");
  const action = parts[0];
  const reference = parts.slice(1).join(":");

  const record = demoStatuses.get(reference);

  if (
    !["approve", "decline"].includes(action) ||
    !record
  ) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Demo request unavailable. It may have expired."
    });

    processedCallbacks.add(callback.id);
    return;
  }

  if (record.status !== "pending") {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: `Already ${record.status}.`
    });

    processedCallbacks.add(callback.id);
    return;
  }

  // Acknowledge the button press.
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: action === "approve"
      ? "Demo approved"
      : "Demo declined"
  });

  record.status = action === "approve"
    ? "approved"
    : "declined";

  record.decidedAt = new Date().toISOString();
  processedCallbacks.add(callback.id);

  const originalText =
    callback.message.text || "Demo verification event";

  // Update the Telegram message and remove its buttons.
  await telegramRequest("editMessageText", {
    chat_id: callbackChatId,
    message_id: callback.message.message_id,
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

// Polling is guarded so this function starts only once per process.
async function handleTelegramUpdates() {
  if (pollingStarted) {
    console.log("Polling already started; ignoring duplicate start.");
    return;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("Telegram polling disabled: missing configuration.");
    return;
  }

  pollingStarted = true;

  let offset = 0;

  console.log("Starting Telegram update polling...");

  while (!pollingStopped) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            offset,
            timeout: 25,
            allowed_updates: ["callback_query"]
          }),
          signal: AbortSignal.timeout(35000)
        }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        const error = new Error(
          data.description || "Telegram polling failed"
        );

        error.telegramCode = data.error_code;
        throw error;
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
            "Button callback failed:",
            error.message
          );
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);

      if (error.telegramCode === 409) {
        pollingConflict = true;

        console.error(
          "Polling stopped because another getUpdates request " +
          "is active. Stop the other bot instance, then restart " +
          "this Render service."
        );

        // Do not keep competing with the other poller.
        pollingStopped = true;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  pollingStarted = false;
  console.log("Telegram polling stopped.");
}

// Serve the frontend.
app.use(express.static(__dirname));

app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(
    path.join(__dirname, "index.html"),
    error => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 500).send(
          "Unable to load index.html."
        );
      }
    }
  );
});

// Start the server and polling process.
app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  handleTelegramUpdates();
});
