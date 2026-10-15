let currentRef = null;
let currentStage = null;
let pollTimer = null;
let countdownTimer = null;

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

function stopTimers() {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);

  pollTimer = null;
  countdownTimer = null;
}

function show(id, step) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(id);

  if (page) page.classList.add("active");

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

async function requestReview(stage) {
  const status = document.getElementById("reviewStatus");

  currentStage = stage;
  currentRef = null;

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
      throw new Error(data.error || "Demo request failed");
    }

    currentRef = data.reference;

    if (status) {
      status.textContent =
        `Review requested. Reference: ${currentRef}`;
    }

    watchReview(currentRef, stage);
  } catch (error) {
    console.error("Demo request failed:", error);

    if (status) {
      status.textContent =
        "Unable to request review. Check the server logs.";
    }
  }
}

function watchReview(reference, stage) {
  clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(
        `/api/demo-status/${encodeURIComponent(reference)}`
      );

      if (!response.ok) return;

      const data = await response.json();

      if (currentRef !== reference || currentStage !== stage) {
        return;
      }

      if (data.status === "approved") {
        stopTimers();

        const next = stageOrder[stage];

        currentRef = null;
        currentStage = null;

        if (next) {
          show(next.approvedPage, next.approvedStep);
        }
      } else if (data.status === "declined") {
        stopTimers();

        currentRef = null;
        currentStage = null;

        show("declinePage", 7);
      }
    } catch (error) {
      console.error("Status check failed:", error);
    }
  }, 2000);
}

function startWait(stage) {
  stopTimers();

  show("loadingPage", 4);

  const secondsDisplay = document.getElementById("seconds");
  const status = document.getElementById("reviewStatus");

  let seconds = 5;

  if (secondsDisplay) {
    secondsDisplay.textContent = `${seconds}s`;
  }

  if (status) {
    status.textContent = "Requesting demo review...";
  }

  requestReview(stage);

  countdownTimer = setInterval(() => {
    seconds--;

    if (secondsDisplay) {
      secondsDisplay.textContent = `${Math.max(0, seconds)}s`;
    }

    if (seconds <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;

      if (status) {
        status.textContent =
          "Waiting for the demo reviewer to approve or decline.";
      }
    }
  }, 1000);
}

document.getElementById("startBtn").addEventListener("click", () => {
  show("numberPage", 2);
});

document.getElementById("numberBtn").addEventListener("click", () => {
  const number = document.getElementById("demoNumber").value.trim();

  if (!number) {
    alert("Enter a fictional test number.");
    return;
  }

  // Only the demo stage is sent to the server.
  show("pinPage", 3);
});

document.getElementById("pinBtn").addEventListener("click", () => {
  const pin = document.getElementById("demoPin").value;

  if (!/^\d{5}$/.test(pin)) {
    alert("Enter a five-digit fictional test PIN.");
    return;
  }

  startWait("pin_demo");
});

document.getElementById("otp1Btn").addEventListener("click", () => {
  const otp = document.getElementById("demoOtp1").value;

  if (!/^\d{4}$/.test(otp)) {
    alert("Enter a four-digit fictional test code.");
    return;
  }

  startWait("otp1_demo");
});

document.getElementById("otp2Btn").addEventListener("click", () => {
  const otp = document.getElementById("demoOtp2").value;

  if (!/^\d{4}$/.test(otp)) {
    alert("Enter a four-digit fictional test code.");
    return;
  }

  startWait("otp2_demo");
});

document.getElementById("restartSuccess").addEventListener("click", resetDemo);
document.getElementById("restartDecline").addEventListener("click", resetDemo);

function resetDemo() {
  stopTimers();

  currentRef = null;
  currentStage = null;

  document.getElementById("demoNumber").value = "";
  document.getElementById("demoPin").value = "";
  document.getElementById("demoOtp1").value = "";
  document.getElementById("demoOtp2").value = "";

  show("homePage", 1);
}
