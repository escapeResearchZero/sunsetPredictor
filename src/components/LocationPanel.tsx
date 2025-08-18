import React, { useCallback, useEffect, useState } from "react";

type Coords = { lat: number; lon: number };
type Props = {
  /** 接收坐标与展示名（可选） */
  onChange?: (coords: Coords, displayName: string) => void;
  /** 初始坐标（可选） */
  initial?: Coords;
  /** 输入框/按钮的额外 class（可选） */
  className?: string;
};

/** 超简洁、稳定的定位 + 反地理（英文）面板 */
export default function LocationPanel({ onChange, initial, className }: Props) {
  const [coords, setCoords] = useState<Coords | null>(initial ?? null);
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [latInput, setLatInput] = useState(initial ? String(initial.lat) : "");
  const [lonInput, setLonInput] = useState(initial ? String(initial.lon) : "");

  // 简单的反地理：BigDataCloud（英文）
  const fetchPlaceEN = useCallback(async (lat: number, lon: number) => {
    try {
      const url =
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const name =
        j.city ||
        j.locality ||
        j.principalSubdivision ||
        j.countryName ||
        `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      return String(name);
    } catch (e) {
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
  }, []);

  // coords 变化时解析地名
  useEffect(() => {
    (async () => {
      if (!coords) return;
      setBusy(true);
      setErr(null);
      const name = await fetchPlaceEN(coords.lat, coords.lon);
      setPlace(name);
      setBusy(false);
      onChange?.(coords, name);
    })();
  }, [coords, fetchPlaceEN, onChange]);

  // 点击“Use my location”
  const useMyLocation = () => {
    setBusy(true);
    setErr(null);
    if (!("geolocation" in navigator)) {
      setBusy(false);
      setErr("Geolocation unsupported.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(5);
        const lon = +pos.coords.longitude.toFixed(5);
        setCoords({ lat, lon });
        setLatInput(String(lat));
        setLonInput(String(lon));
      },
      (e) => {
        setBusy(false);
        setErr(e.message || "Failed to get location.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // 手动应用
  const applyManual = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setErr("Invalid numbers.");
      return;
    }
    setErr(null);
    setCoords({ lat, lon });
  };

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="text-sm text-gray-700">
        Location:&nbsp;
        {place
          ? <span className="font-medium text-gray-900">{place}</span>
          : coords
            ? <span className="font-mono">{coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}</span>
            : <span className="text-gray-400">unknown</span>}
        {busy && <span className="ml-2 text-xs text-gray-400">(loading…)</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={useMyLocation}
          className="rounded-lg border px-3 py-1.5 hover:border-orange-500 hover:text-orange-600"
        >
          Use my location
        </button>

        <input
          type="number"
          inputMode="decimal"
          placeholder="lat"
          value={latInput}
          onChange={(e) => setLatInput(e.target.value)}
          className="w-36 rounded-md border px-2 py-1 text-sm"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="lon"
          value={lonInput}
          onChange={(e) => setLonInput(e.target.value)}
          className="w-36 rounded-md border px-2 py-1 text-sm"
        />
        <button
          onClick={applyManual}
          className="rounded-lg border px-3 py-1.5 hover:border-orange-500 hover:text-orange-600"
        >
          Apply
        </button>
      </div>

      {err && <div className="text-xs text-amber-700">{err}</div>}
    </div>
  );
}
