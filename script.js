"use strict";

let currentRef = null;
let currentStage = null;
let pollTimer = null;
let reviewInProgress = false;
let pinTriggered = false;

const stageOrder = {
  pin_demo: "otp1Page",
  otp1_demo: "otp2Page",
  otp2_demo: "successPage"
};

function show(id) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(id);

  if (page) {
    page.classList.add("active");
  }
}

function stopTimers() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function requestReview(stage) {
  const status = document.getElementById("reviewStatus");

  try {
    if (status) {
      status.textContent = "Creating demo review...";
    }

    /*
     * Only the stage is sent.
     * No phone number, PIN, message contents, or code is sent.
     */
    const response = await fetch("/api/demo-status", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        stage
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success || !data.reference) {
      throw new Error(
        data.error || "Unable to create demo review."
      );
    }

    currentRef = data.reference;
    currentStage = stage;

    if (status) {
      status.textContent =
        "Demo reference: " +
        currentRef +
        ". Waiting for Telegram approval or decline...";
    }

    watchReview(currentRef, currentStage);
  } catch (error) {
    console.error("Demo review error:", error);

    reviewInProgress = false;

    if (status) {
      status.textContent =
        "Unable to contact the server. Check the deployment logs and try again.";
    }
  }
}

function watchReview(reference, stage) {
  stopTimers();

  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(
        "/api/demo-status/" +
        encodeURIComponent(reference),
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (
        currentRef !== reference ||
        currentStage !== stage
      ) {
        return;
      }

      if (data.status === "approved") {
        stopTimers();

        reviewInProgress = false;

        currentRef = null;
        currentStage = null;

        const nextPage = stageOrder[stage];

        if (nextPage) {
          show(nextPage);
        } else {
          show("successPage");
        }
      }

      if (data.status === "declined") {
        stopTimers();

        reviewInProgress = false;

        currentRef = null;
        currentStage = null;

        show("declinePage");
      }
    } catch (error) {
      console.error("Review status check failed:", error);
    }
  }, 2000);
}

function startWait(stage) {
  if (reviewInProgress) {
    return;
  }

  reviewInProgress = true;

  stopTimers();

  currentRef = null;
  currentStage = null;

  show("loadingPage");

  const status = document.getElementById("reviewStatus");

  if (status) {
    status.textContent =
      "Waiting for the demo reviewer...";
  }

  requestReview(stage);
}

function resetDemo() {
  stopTimers();

  currentRef = null;
  currentStage = null;

  reviewInProgress = false;
  pinTriggered = false;

  document.getElementById("demoNumber").value = "";
  document.getElementById("demoPin").value = "";
  document.getElementById("demoCode").value = "";
  document.getElementById("pastedMessage").value = "";

  show("homePage");
}

/* Start page */
document.getElementById("startBtn").addEventListener(
  "click",
  () => {
    show("numberPage");
  }
);

/* Accept any 9 digits for the demo phone number. */
document.getElementById("demoNumber").addEventListener(
  "input",
  event => {
    event.target.value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 9);
  }
);

document.getElementById("numberBtn").addEventListener(
  "click",
  () => {
    const input = document.getElementById("demoNumber");

    if (!/^\d{9}$/.test(input.value)) {
      alert("Enter exactly 9 digits for the demo.");
      input.focus();
      return;
    }

    show("pinPage");
    document.getElementById("demoPin").focus();
  }
);

/*
 * Accept any 5 digits locally.
 * Automatically start the spinner when digit five is entered.
 */
document.getElementById("demoPin").addEventListener(
  "input",
  event => {
    const input = event.target;

    input.value = input.value
      .replace(/\D/g, "")
      .slice(0, 5);

    if (
      input.value.length === 5 &&
      !pinTriggered &&
      !reviewInProgress
    ) {
      pinTriggered = true;

      /*
       * Do not send or store the input value.
       */
      input.value = "";

      startWait("pin_demo");
    }
  }
);

/* Copy the fictional demo message. */
document.getElementById("copyBtn").addEventListener(
  "click",
  async () => {
    const message =
      document.getElementById("demoMessage").textContent.trim();

    try {
      await navigator.clipboard.writeText(message);

      document.getElementById("copyBtn").textContent =
        "Copied!";

    } catch (error) {
      const pasted = document.getElementById("pastedMessage");

      pasted.value = message;
      pasted.focus();
      pasted.select();

      document.getElementById("copyBtn").textContent =
        "Select and copy the message";
    }
  }
);

/* Continue after pasting the fictional message. */
document.getElementById("messageBtn").addEventListener(
  "click",
  () => {
    const expected =
      document.getElementById("demoMessage").textContent.trim();

    const pasted =
      document.getElementById("pastedMessage").value.trim();

    if (pasted !== expected) {
      alert("Copy and paste the complete fictional demo message.");
      return;
    }

    startWait("otp1_demo");
  }
);

/* Accept any 4 digits locally. */
document.getElementById("demoCode").addEventListener(
  "input",
  event => {
    event.target.value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 4);
  }
);

document.getElementById("finishBtn").addEventListener(
  "click",
  () => {
    const input = document.getElementById("demoCode");

    if (!/^\d{4}$/.test(input.value)) {
      alert("Enter exactly 4 demo digits.");
      input.focus();
      return;
    }

    /*
     * The code is never sent to the server.
     */
    input.value = "";

    startWait("otp2_demo");
  }
);

/* Restart buttons */
document.getElementById("restartSuccess").addEventListener(
  "click",
  resetDemo
);

document.getElementById("restartDecline").addEventListener(
  "click",
  resetDemo
);

/* Back buttons */
document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => {
    if (!reviewInProgress) {
      show(button.dataset.back);
    }
  });
});
