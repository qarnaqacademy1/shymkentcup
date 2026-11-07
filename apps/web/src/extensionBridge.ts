import type { Active } from "@nazar/shared";
export type ExtensionState = {
  active: Active | null;
  queueCount: number;
  syncStatus: string;
};
export function extensionRequest(
  ownerId: string,
  type: string,
  data: object = {},
): Promise<ExtensionState> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(
      () => {
        window.removeEventListener("message", receive);
        reject(
          Error(
            "Расширение Nazar не обнаружено. Доступен самостоятельный таймер.",
          ),
        );
      },
      type === "state" ? 1800 : 25000,
    );
    function receive(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== "nazar4-response" ||
        event.data.requestId !== requestId
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.response?.ok) resolve(event.data.response.state);
      else
        reject(Error(event.data.response?.error ?? "Расширение не отвечает"));
    }
    window.addEventListener("message", receive);
    window.postMessage(
      { channel: "nazar4-request", requestId, type, ownerId, ...data },
      location.origin,
    );
  });
}
