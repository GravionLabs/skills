// setupFiles (#672): the deliver loop waits 5/30/120 s before it retries a failed gh call and 5/15 minutes after a harness
// failure. Every loop a test starts inherits 0 waits unless a case sets its own, so a fake gh that rejects a call never sleeps.
process.env.DELIVER_GH_RETRY_SECONDS ??= '0,0,0';
process.env.DELIVER_HARNESS_RETRY_MINUTES ??= '0,0,0';
