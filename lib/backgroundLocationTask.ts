import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";

// Runs outside the React tree (its own headless JS context), so it can't
// read component state — every value it needs (the auth token) has to be
// re-fetched from storage on each firing.
export const BACKGROUND_LOCATION_TASK = "near-and-now-rider-background-location";

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
  const loc = locations?.[locations.length - 1];
  if (!loc) return;

  try {
    const session = await getSession();
    if (!session?.token) return;
    await apiFetch(
      "/delivery-partner/location",
      {
        method: "POST",
        body: {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          heading: loc.coords.heading ?? null,
          speed: loc.coords.speed ?? null,
          accuracy: loc.coords.accuracy ?? null,
          // GPS fix's own capture time, not send time — lets the backend
          // reject a stale fix even though server-receipt time would
          // otherwise make it look current. See home.tsx's sendLocation.
          timestamp: loc.timestamp ?? null,
        },
      },
      session.token
    );
  } catch {}
});

export async function startBackgroundLocationTracking() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 50,
    timeInterval: 15000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Near & Now — Delivery in progress",
      notificationBody: "Sharing your location while you're online.",
    },
  });
}

export async function stopBackgroundLocationTracking() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (!isRegistered) return;
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
