export async function setupOffline(button, status) {
  if (!("serviceWorker" in navigator)) {
    button.disabled = true;
    status.textContent = "Offline storage is unavailable in this browser.";
    return;
  }
  let registration;
  try {
    registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    status.textContent =
      "Save the app and dictionary here for reading without a connection.";
  } catch {
    status.textContent =
      "Offline setup is unavailable. Your readings are still saved on this device.";
    button.disabled = true;
    return;
  }
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = "Preparing offline files…";
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      status.textContent = "Offline setup timed out. Reconnect and try again.";
      button.disabled = false;
      channel.port1.close();
    }, 180000);
    channel.port1.onmessage = ({ data }) => {
      if (data.error || data.done) {
        clearTimeout(timer);
        button.disabled = false;
        channel.port1.close();
        status.textContent = data.error
          ? "Some files could not be saved. Reconnect and try again."
          : "Ready for offline reading, definitions, and saved PDFs on this device.";
      } else
        status.textContent = `Saving offline files: ${data.count} of ${data.total}…`;
    };
    (registration.active || navigator.serviceWorker.controller)?.postMessage(
      { type: "prepare" },
      [channel.port2],
    );
  };
}
