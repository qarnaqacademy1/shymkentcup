// apps/extension/src/bridge.ts
var allowed = /* @__PURE__ */ new Set([
  "state",
  "start",
  "pause",
  "resume",
  "finish",
  "sync"
]);
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "nazar4-request")
    return;
  const { requestId, type, ownerId, goal, minutes, done, note } = event.data;
  if (typeof requestId !== "string" || requestId.length > 100 || !allowed.has(type) || typeof ownerId !== "string")
    return;
  let response;
  try {
    const r = await chrome.runtime.sendMessage({
      type,
      webOwnerId: ownerId,
      goal,
      minutes,
      done,
      note
    });
    response = r.ok ? {
      ok: true,
      state: {
        active: r.state.active,
        queueCount: r.state.queueCount,
        syncStatus: r.state.syncStatus
      }
    } : { ok: false, error: r.error };
  } catch {
    response = {
      ok: false,
      error: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0438\u043B\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443."
    };
  }
  window.postMessage(
    { channel: "nazar4-response", requestId, response },
    location.origin
  );
});
