import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./client";

/** Keep reads current even when Realtime is unavailable or a tab has been suspended. */
export function watchUpdates(
  name: string,
  tables: { table: string; filter: string }[],
  refresh: () => Promise<void>,
) {
  let disposed = false;
  let subscribed = false;
  let refreshing = false;
  let refreshAgain = false;
  let channel: RealtimeChannel | undefined;

  const reload = async () => {
    if (disposed || document.visibilityState === "hidden" || navigator.onLine === false) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      await refresh();
    } catch (error) {
      // Leave the last successful data visible; the next refresh can recover.
      console.warn("Could not refresh site data.", error);
    } finally {
      refreshing = false;
      if (refreshAgain && !disposed) {
        refreshAgain = false;
        void reload();
      }
    }
  };

  const removeChannel = () => {
    subscribed = false;
    const previous = channel;
    channel = undefined;
    if (previous) void supabase.removeChannel(previous);
  };

  const connect = () => {
    if (
      disposed ||
      channel ||
      navigator.onLine === false ||
      import.meta.env.VITE_SUPABASE_REALTIME_ENABLED === "false"
    )
      return;
    const next = supabase.channel(name);
    channel = next;
    for (const { table, filter } of tables) {
      next.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
        void reload();
      });
    }
    next.subscribe((status) => {
      if (disposed || channel !== next) return;
      subscribed = status === "SUBSCRIBED";
      if (subscribed)
        void reload(); // Catch changes missed while disconnected.
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        // Removing the failed channel stops endless socket retries. Continue using HTTP
        // until the network comes back (or the page is reloaded).
        removeChannel();
        void reload();
      }
    });
  };

  const resume = () => {
    void reload();
  };
  const online = () => {
    connect();
    void reload();
  };
  const offline = () => {
    removeChannel();
  };
  const timer = window.setInterval(() => {
    if (!subscribed) void reload();
  }, 30_000);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  void reload();
  connect();

  return () => {
    disposed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    removeChannel();
  };
}
