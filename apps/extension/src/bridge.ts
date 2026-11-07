// Runs only on the configured Nazar website, in Chrome's isolated content-script world.
const allowed = new Set([
  "state",
  "start",
  "pause",
  "resume",
  "finish",
  "sync",
]);
window.addEventListener("message", async (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.channel !== "nazar4-request"
  )
    return;
  const { requestId, type, ownerId, goal, minutes, done, note } = event.data;
  if (
    typeof requestId !== "string" ||
    requestId.length > 100 ||
    !allowed.has(type) ||
    typeof ownerId !== "string"
  )
    return;
  let response;
  try {
    const r = await chrome.runtime.sendMessage({
      type,
      webOwnerId: ownerId,
      goal,
      minutes,
      done,
      note,
    });
    // History consent, credentials and foreign queues never cross this bridge.
    response = r.ok
      ? {
          ok: true,
          state: {
            active: r.state.active,
            queueCount: r.state.queueCount,
            syncStatus: r.state.syncStatus,
          },
        }
      : { ok: false, error: r.error };
  } catch {
    response = {
      ok: false,
      error: "Расширение обновлено или недоступно. Перезагрузите страницу.",
    };
  }
  window.postMessage(
    { channel: "nazar4-response", requestId, response },
    location.origin,
  );
});
