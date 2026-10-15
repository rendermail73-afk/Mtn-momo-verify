const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const demoStatuses = new Map();
const processedCallbacks = new Set();

let pollingStarted = false;
let pollingConflict = false;

async function telegramRequest(method, body) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error("Telegram configuration is missing.");
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
    telegramConfigured: Boolean(BOT_TOKEN && CHAT_ID),
    pollingStarted,
    pollingConflict
  });
});

// Create a demo request.
app.post("/api/demo-status", async (req, res) => {
  try {
    const allowedStages = [
      "phone_demo",
      "pin_demo",
      "otp1_demo",
      "otp2_demo"
    ];

    const stage = req.body.stage;

    if (!allowedStages.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid demo stage"
      });
    }

    // Never store or transmit submitted credential values.
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
      "🧪 DEMO REVIEW REQUEST",
      "",
      `Reference: ${reference}`,
      `Stage: ${stage}`,
      `Status: PENDING`,
      `Time: ${record.createdAt}`,
      "",
      "Synthetic demonstration only.",
      "No PINs, OTPs, or SMS contents are transmitted."
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
      console.log("Demo event:", message);
    }

    res.json({
      success: true,
      reference,
      status: record.status,
      stage
    });
  } catch (error) {
    console.error("Demo request error:", error.message);

    res.status(500).json({
      success: false,
      error: "Unable to create demo request"
    });
  }
});

// Read the current status.
app.get("/api/demo-status/:reference", (req, res) => {
  const record = demoStatuses.get(req.params.reference);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: "Demo request not found"
    });
  }

  res.json({
    success: true,
    reference: req.params.reference,
    stage: record.stage,
    status: record.status
  });
});

// Handle Telegram button presses.
async function processCallback(callback) {
  if (!callback || !callback.id) return;
  if (processedCallbacks.has(callback.id)) return;

  const chatId = callback.message?.chat?.id;

  if (!chatId || String(chatId) !== String(CHAT_ID)) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Unauthorized demo chat."
    });

    processedCallbacks.add(callback.id);
    return;
  }

  const [action, reference] = String(callback.data || "").split(":");
  const record = demoStatuses.get(reference);

  if (!["approve", "decline"].includes(action) || !record) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Demo request unavailable."
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

  record.status = action === "approve" ? "approved" : "declined";
  record.decidedAt = new Date().toISOString();

  processedCallbacks.add(callback.id);

  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: `Demo ${record.status}`
  });

  const originalText =
    callback.message.text || "Demo review request";

  await telegramRequest("editMessageText", {
    chat_id: chatId,
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

// Poll Telegram for callback queries.
async function handleTelegramUpdates() {
  if (pollingStarted) return;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("Telegram polling disabled: configuration missing.");
    return;
  }

  pollingStarted = true;
  let offset = 0;

  console.log("Starting Telegram update polling...");

  while (true) {
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

        if (update.callback_query) {
          try {
            await processCallback(update.callback_query);
          } catch (error) {
            console.error("Callback error:", error.message);
          }
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);

      if (error.telegramCode === 409) {
        pollingConflict = true;

        console.error(
          "Another process is polling this bot. " +
          "Stop the other process before restarting this service."
        );

        break;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  pollingStarted = false;
}

// Serve the website.
app.use(express.static(__dirname));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();

  res.sendFile(
    path.join(__dirname, "index.html"),
    error => {
      if (error && !res.headersSent) {
        res.status(500).send("Unable to load the demo page.");
      }
    }
  );
});

app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  handleTelegramUpdates();
});
