// Time-of-day palette for the city home screen. The skyline shifts with the
// viewer's real local clock — morning, day, sunset, night, late night —
// mirroring the "the city changes with the time" idea.

export interface TodPalette {
  key: "morning" | "day" | "sunset" | "night" | "late";
  label: string;
  skyTop: string;
  skyBottom: string;
  building: string; // front face base
  buildingShade: string; // side face
  buildingRoof: string;
  windowDark: string; // vacant window
  windowAmbient: string; // decorative lit window
  windowUser: string; // an online user's window
  windowGlow: string; // glow color around user windows
  silhouette: string; // distant skyline
  star: number; // star field opacity 0..1
}

const PALETTES: Record<TodPalette["key"], TodPalette> = {
  morning: {
    key: "morning",
    label: "Morning",
    skyTop: "#8fbce6",
    skyBottom: "#f4cdd6",
    building: "#41506d",
    buildingShade: "#2f3c55",
    buildingRoof: "#4d5d7c",
    windowDark: "#39465e",
    windowAmbient: "#c9d4e6",
    windowUser: "#ffe4a0",
    windowGlow: "#ffd070",
    silhouette: "#b9c4da",
    star: 0,
  },
  day: {
    key: "day",
    label: "Day",
    skyTop: "#4c93da",
    skyBottom: "#c3e2f6",
    building: "#465878",
    buildingShade: "#33425c",
    buildingRoof: "#556788",
    windowDark: "#3d4c66",
    windowAmbient: "#dbe6f2",
    windowUser: "#ffdf9a",
    windowGlow: "#ffcf66",
    silhouette: "#a9c3dd",
    star: 0,
  },
  sunset: {
    key: "sunset",
    label: "Sunset",
    skyTop: "#3d2f63",
    skyBottom: "#f0894e",
    building: "#33304e",
    buildingShade: "#241f38",
    buildingRoof: "#3c3856",
    windowDark: "#2b2740",
    windowAmbient: "#ffcaa0",
    windowUser: "#ffd98a",
    windowGlow: "#ff9e57",
    silhouette: "#5a3f63",
    star: 0.12,
  },
  night: {
    key: "night",
    label: "Night",
    skyTop: "#0e1730",
    skyBottom: "#243356",
    building: "#1b2138",
    buildingShade: "#12162a",
    buildingRoof: "#232a45",
    windowDark: "#20263c",
    windowAmbient: "#8b7d54",
    windowUser: "#ffdf95",
    windowGlow: "#ffce5e",
    silhouette: "#161f3a",
    star: 0.55,
  },
  late: {
    key: "late",
    label: "Late Night",
    skyTop: "#060912",
    skyBottom: "#0f1428",
    building: "#11152a",
    buildingShade: "#0a0d1c",
    buildingRoof: "#171d34",
    windowDark: "#161b2e",
    windowAmbient: "#7c6c47",
    windowUser: "#ffdb8a",
    windowGlow: "#ffc94f",
    silhouette: "#0c1124",
    star: 0.8,
  },
};

export function currentTod(date = new Date()): TodPalette {
  const h = date.getHours();
  if (h >= 5 && h < 8) return PALETTES.morning;
  if (h >= 8 && h < 16) return PALETTES.day;
  if (h >= 16 && h < 19) return PALETTES.sunset;
  if (h >= 19 && h < 22) return PALETTES.night;
  return PALETTES.late;
}
