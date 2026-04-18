/**
 * Browser vibration helpers for haptic feedback.
 * Uses the Vibration API (supported on most mobile browsers + some desktop).
 * Silently no-ops when unsupported.
 */

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

/** Light tap — node added, connection made */
export function vibrateTap() {
  if (canVibrate()) navigator.vibrate(15);
}

/** Medium pulse — hint revealed, answer loaded */
export function vibratePulse() {
  if (canVibrate()) navigator.vibrate([30, 50, 30]);
}

/** Warning — budget exceeded, high context pressure */
export function vibrateWarning() {
  if (canVibrate()) navigator.vibrate([50, 30, 50, 30, 80]);
}

/** Error — evaluation failed, critical issues */
export function vibrateError() {
  if (canVibrate()) navigator.vibrate([100, 50, 100, 50, 150]);
}

/** Extreme — context thermometer extreme state */
export function vibrateExtreme() {
  if (canVibrate()) navigator.vibrate([80, 30, 80, 30, 80, 30, 120]);
}

/** Success — evaluation passed */
export function vibrateSuccess() {
  if (canVibrate()) navigator.vibrate([20, 40, 60]);
}
