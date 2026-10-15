"use strict";

const demo = {
  currentStep: 1,
  reference: null,
  busy: false,
  pollTimer: null
};

const elements = {
  stepLabel: document.getElementById("stepLabel"),
  status: document.getElementById("statusMessage"),
  spinner: document.getElementById("spinner"),
  startButton: document.getElementById("startButton"),
  continueButton: document.getElementById("continueButton"),
  retryButton: document.getElementById("retryButton"),
  resetButton: document.getElementById("resetButton"),
  progress: document.getElementById("progressBar")
};

function showMessage(message, type = "info") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
}

function setLoading(loading) {
  elements.spinner.hidden = !loading;

  if (elements.continueButton) {
    elements.continueButton.disabled = loading;
  }

  if (elements.startButton) {
    elements.startButton.disabled = loading;
  }
}

function updateProgress() {
  elements.stepLabel.textContent =
    `Demo step ${demo.currentStep} of 3`;

  elements.progress.style.width =
    `${(demo.currentStep / 3) * 100}%`;
}

function showStep(step) {
  demo.currentStep = step;

  document.querySelectorAll(".demo-step").forEach(section => {
    section.hidden =
      Number(section.dataset.step) !== step;
  });

  updateProgress();

  elements.startButton.hidden = step !== 1;
  elements.continueButton.hidden = step === 1;
  elements.retryButton.hidden = true;
  elements.resetButton.hidden = false;

  setLoading(false);

  showMessage(
    "This is a simulated demo. No financial credentials are collected.",
    "info"
  );
}

function stopPolling() {
  if (demo.pollTimer) {
    clearTimeout(demo.pollTimer);
    demo.pollTimer = null;
  }
}

async function requestApproval() {
  if (demo.busy) {
    return;
  }

  demo.busy = true;
  stopPolling();
  setLoading(true);

  showMessage(
    "Sending the demo request for review...",
    "info"
  );

  try {
    // Only the simulated stage is sent.
    const response = await fetch("/api/demo-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        stage: `demo_step_${demo.currentStep}`
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "Could not create the demo request."
      );
    }

    demo.reference = result.reference;

    showMessage(
      `Demo request ${demo.reference} is awaiting Telegram review.`,
      "pending"
    );

    pollStatus();
  } catch (error) {
    demo.busy = false;
    setLoading(false);

    showMessage(
      error.message || "A connection error occurred.",
      "error"
    );
  }
}

async function pollStatus() {
  if (!demo.reference) {
    demo.busy = false;
    setLoading(false);
    return;
  }

  try {
    const response = await fetch(
      `/api/demo-status/${encodeURIComponent(demo.reference)}`,
      { cache: "no-store" }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "Unable to check the demo status."
      );
    }

    if (result.status === "pending") {
      demo.pollTimer = setTimeout(pollStatus, 2000);
      return;
    }

    demo.busy = false;
    setLoading(false);

    if (result.status === "approved") {
      showMessage(
        "Demo approved! You can continue to the next simulated step.",
        "success"
      );

      if (demo.currentStep < 3) {
        elements.continueButton.hidden = false;
      } else {
        showCompletion();
      }

      return;
    }

    if (result.status === "declined") {
      showMessage(
        "Demo declined. You can retry this same step.",
        "error"
      );

      elements.retryButton.hidden = false;
      elements.continueButton.hidden = true;
      return;
    }

    throw new Error("Unknown demo status.");
  } catch (error) {
    demo.busy = false;
    setLoading(false);

    showMessage(
      `${error.message} You can try again.`,
      "error"
    );

    elements.retryButton.hidden = false;
  }
}

function showCompletion() {
  document.querySelectorAll(".demo-step").forEach(section => {
    section.hidden = true;
  });

  document.getElementById("completionPage").hidden = false;

  elements.startButton.hidden = true;
  elements.continueButton.hidden = true;
  elements.retryButton.hidden = true;

  elements.stepLabel.textContent = "Demo complete";
  elements.progress.style.width = "100%";

  showMessage(
    "All simulated steps are complete. No financial credentials were used.",
    "success"
  );
}

function resetDemo() {
  stopPolling();

  demo.currentStep = 1;
  demo.reference = null;
  demo.busy = false;

  document.getElementById("completionPage").hidden = true;

  showStep(1);
}

elements.startButton.addEventListener("click", () => {
  requestApproval();
});

elements.continueButton.addEventListener("click", () => {
  if (demo.busy) {
    return;
  }

  if (demo.currentStep < 3) {
    showStep(demo.currentStep + 1);
  } else {
    showCompletion();
  }
});

elements.retryButton.addEventListener("click", () => {
  if (!demo.busy) {
    requestApproval();
  }
});

elements.resetButton.addEventListener("click", resetDemo);

showStep(1);
