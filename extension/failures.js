// Recovery policy and localized text travel together. Resolve the text while
// Chrome is still available: the updated/removed-extension dialog outlives it.
import { t } from "./i18n.js";

// What the recovery dialog offers for each failure: Try again (retry), Reload
// page (reload), or nothing more than Play original sound (null).
const policies = {
  // Failures that no retry and no reload can help: the video's own sound
  // (locked, or in a format Musicless cannot read), or a player whose sound it
  // cannot reach.
  protected: { action: null },
  codec: { action: null },
  source: { action: null },
  // Failures only a fresh page can help.
  // A video whose audio went by before Musicless was turned on did not fail:
  // the dialog says that Musicless is on, and that a reload will do.
  missed: { action: "reload", title: "done_heading" },
  uncaptured: { action: "reload" },
  engine: { action: "reload" },
  // Sound that cannot start: the video's sound already goes through an audio
  // context that will not run, and only a new page gets a new one.
  audio: { action: "reload" },
  updated: { action: "reload" },
  // Worth trying again on this page.
  slow: { action: "retry" },
  error: { action: "retry", describe: false },
};

const failures = Object.fromEntries(Object.entries(policies).map(([reason, policy]) => [reason, {
  action: policy.action,
  title: t(policy.title ?? "panel_title"),
  message: t(`failure_${reason}`),
  describe: policy.describe !== false,
}]));

// A reason without a policy still says what went wrong: the generic message,
// and Try again.
const unknown = { ...failures.error, describe: true };

export function createFailure(reason, detail) {
  return { reason, ...(failures[reason] ?? unknown), detail: detail ?? null };
}
