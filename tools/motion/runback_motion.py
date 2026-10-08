"""Load Runback motion data and prepare it for a model.

Reads the strength training export from the app (folder `bewegungsdaten/`; older
motion exports without a folder also work) and provides, per strength session,
acceleration, gyroscope, sets, and events as pandas DataFrames. Instructions and
format: docs/motion-data.md.

    python tools/motion/runback_motion.py runback-krafttraining.zip
    python tools/motion/runback_motion.py export.zip --windows windows.npz

Dependencies: numpy, pandas.
"""
from __future__ import annotations

import argparse
import io
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

EXPORT_FORMAT = "runback-motion-export"
# In the strength training export, the motion data lives in this folder; older exports had none.
STRENGTH_EXPORT_DIRECTORY = "bewegungsdaten/"
SUPPORTED_VERSIONS = {1, 2, 3}
# Same as MotionLabels.BATCH_WINDOW_MS: two real sets of the same exercise are never this close.
BATCH_WINDOW_MS = 15_000
CHANNELS = ["ax", "ay", "az", "gx", "gy", "gz"]


@dataclass
class Session:
    id: str
    meta: dict
    accel: pd.DataFrame  # t_ms, x, y, z  (m/s², including gravity)
    gyro: pd.DataFrame  # t_ms, x, y, z  (rad/s)
    sets: pd.DataFrame  # one set per row, final state from the app
    events: pd.DataFrame  # t_ms, event, …
    # From export 3: watch detections with detected and confirmed count, one row per repetition.
    detections: pd.DataFrame = None
    detected_reps: pd.DataFrame = None

    @property
    def has_motion(self) -> bool:
        return len(self.accel) > 0

    @property
    def wrist(self) -> str:
        return self.meta.get("wrist", "unknown")

    @property
    def clock_aligned(self) -> bool:
        return self.meta.get("clock") is not None


def load_export(path: str | Path) -> list[Session]:
    """All sessions of an export. Missing values are NaN, never 0."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        root = STRENGTH_EXPORT_DIRECTORY if f"{STRENGTH_EXPORT_DIRECTORY}manifest.json" in names else ""
        if f"{root}manifest.json" not in names:
            raise ValueError("Not a Runback motion export")
        manifest = json.loads(archive.read(f"{root}manifest.json"))
        if manifest.get("format") != EXPORT_FORMAT:
            raise ValueError("Not a Runback motion export")
        if manifest.get("formatVersion") not in SUPPORTED_VERSIONS:
            raise ValueError(f"Export version {manifest.get('formatVersion')} is not supported")
        summary = pd.read_csv(io.BytesIO(archive.read(f"{root}sessions.csv")), dtype={"session_id": str})

        def table(name: str, columns: list[str]) -> pd.DataFrame:
            name = root + name
            if name not in names:
                return pd.DataFrame(columns=columns)
            return pd.read_csv(io.BytesIO(archive.read(name)), keep_default_na=True)

        sessions = []
        for session_id in summary["session_id"]:
            meta = json.loads(archive.read(f"{root}{session_id}/meta.json"))
            sessions.append(
                Session(
                    id=session_id,
                    meta=meta,
                    accel=table(f"{session_id}/accel.csv", ["t_ms", "x", "y", "z"]),
                    gyro=table(f"{session_id}/gyro.csv", ["t_ms", "x", "y", "z"]),
                    sets=table(f"{session_id}/sets.csv", []),
                    events=table(f"{session_id}/events.csv", ["t_ms", "event"]),
                    detections=table(f"{session_id}/detections.csv", ["kind", "detection_id", "set_id"]),
                    detected_reps=table(f"{session_id}/detected_reps.csv", ["detection_id", "rep_index", "start_ms", "end_ms"]),
                )
            )
        for session in sessions:
            _add_labels(session)
        return sessions


def _add_labels(session: Session) -> None:
    """Column `label` in `sets`: `detected`, `single`, `batch`, or empty (not ticked off).

    Older exports do not have it; then the same rule as in the app applies
    (MotionLabels.completionLabels): sets of the same exercise ticked off within
    `BATCH_WINDOW_MS` are entered afterward — weak labels only.
    """
    sets = session.sets
    if sets.empty or "label" in sets.columns:
        return
    labels = pd.Series("", index=sets.index, dtype=object)
    done = sets.dropna(subset=["completed_ms"]).sort_values("completed_ms")
    labels[done.index] = "single"
    for _, group in done.groupby("exercise_id"):
        times = group["completed_ms"].to_numpy()
        for i in np.flatnonzero(np.diff(times) < BATCH_WINDOW_MS):
            labels[group.index[i]] = "batch"
            labels[group.index[i + 1]] = "batch"
    sets["label"] = labels


def resample(session: Session, rate_hz: float = 50.0) -> pd.DataFrame:
    """Put acceleration and gyroscope on a common, even time grid.

    Linear interpolation; gaps longer than 200 ms stay NaN instead of being bridged.
    """
    if not session.has_motion:
        return pd.DataFrame(columns=["t_ms", *CHANNELS])
    start = session.accel["t_ms"].iloc[0]
    end = session.accel["t_ms"].iloc[-1]
    if len(session.gyro):
        start = max(start, session.gyro["t_ms"].iloc[0])
        end = min(end, session.gyro["t_ms"].iloc[-1])
    grid = np.arange(start, end, 1000.0 / rate_hz)
    out = {"t_ms": grid}
    for prefix, frame in (("a", session.accel), ("g", session.gyro)):
        times = frame["t_ms"].to_numpy(float)
        for axis in "xyz":
            values = np.interp(grid, times, frame[axis].to_numpy(float)) if len(frame) else np.full(len(grid), np.nan)
            out[prefix + axis] = values
        if len(frame):
            gap = _gap_mask(grid, times, max_gap_ms=200.0)
            for axis in "xyz":
                out[prefix + axis][gap] = np.nan
    return pd.DataFrame(out)


def _gap_mask(grid: np.ndarray, times: np.ndarray, max_gap_ms: float) -> np.ndarray:
    index = np.searchsorted(times, grid).clip(1, len(times) - 1)
    return (times[index] - times[index - 1]) > max_gap_ms


def activity(frame: pd.DataFrame, rate_hz: float = 50.0, window_s: float = 1.0) -> np.ndarray:
    """Movement intensity: rolling standard deviation of the gyroscope magnitude (rad/s)."""
    magnitude = np.sqrt(frame["gx"] ** 2 + frame["gy"] ** 2 + frame["gz"] ** 2)
    window = max(1, int(rate_hz * window_s))
    return magnitude.rolling(window, center=True, min_periods=window // 2).std().to_numpy()


def estimate_set_bounds(
    session: Session,
    frame: pd.DataFrame | None = None,
    rate_hz: float = 50.0,
    threshold: float | None = None,
    min_set_s: float = 5.0,
) -> pd.DataFrame:
    """Estimate start and end of each ticked-off set.

    Ticking off usually happens a few seconds after the last repetition step;
    the start of the set is not marked at all. So before each tick, the search
    looks for the last continuous stretch of movement, starting no earlier than
    the previous tick. The result is an estimate (`estimated = True`), not a
    measurement — spot-check it in a plot before training on it.

    If the watch detected the set and the user confirmed the count, its
    boundaries apply (`estimated = False`). `weak = True` marks sets entered
    afterward (`label = batch`): their tick is not at the end of the set.
    """
    frame = resample(session, rate_hz) if frame is None else frame
    done = session.sets.dropna(subset=["completed_ms"]).sort_values("completed_ms")
    if frame.empty or done.empty:
        return pd.DataFrame(columns=["set_id", "start_ms", "end_ms", "estimated", "weak"])
    detected = {}
    if session.detections is not None and "decision" in session.detections:
        accepted = session.detections[(session.detections["kind"] == "detected")
                                      & session.detections["decision"].isin(["confirmed", "corrected"])]
        if "detection_id" in session.sets:
            # sets.csv names the detection the set was last ticked off with; only that one counts.
            current = session.sets.dropna(subset=["detection_id"]).set_index("detection_id")["set_id"]
            accepted = accepted[accepted["detection_id"].isin(current.index)]
        detected = {row["set_id"]: row for _, row in accepted.iterrows()}
    weak = set(session.sets.loc[session.sets["label"] == "batch", "set_id"]) if "label" in session.sets else set()
    level = activity(frame, rate_hz)
    if threshold is None:
        # Between rest (lower quartile) and a set (upper decile).
        quiet, busy = np.nanpercentile(level, 25), np.nanpercentile(level, 90)
        threshold = quiet + 0.3 * (busy - quiet)
    active = np.nan_to_num(level) > threshold
    t = frame["t_ms"].to_numpy()
    rows, previous = [], -np.inf
    for _, row in done.iterrows():
        tick = row["completed_ms"]
        if row["set_id"] in detected:
            hit = detected[row["set_id"]]
            rows.append({"set_id": row["set_id"], "start_ms": hit["start_ms"], "end_ms": hit["end_ms"],
                         "estimated": False, "weak": False})
            previous = tick
            continue
        mask = (t > previous) & (t <= tick)
        idx = np.flatnonzero(mask & active)
        previous = tick
        if idx.size == 0:
            continue
        # Last continuous block before the tick; short pauses (< 2 s) belong to it.
        end_i = idx[-1]
        start_i = end_i
        gap_limit = int(2.0 * rate_hz)
        for i in idx[::-1][1:]:
            if start_i - i > gap_limit:
                break
            start_i = i
        if (t[end_i] - t[start_i]) < min_set_s * 1000:
            continue
        rows.append({"set_id": row["set_id"], "start_ms": t[start_i], "end_ms": t[end_i], "estimated": True,
                     "weak": row["set_id"] in weak})
    return pd.DataFrame(rows, columns=["set_id", "start_ms", "end_ms", "estimated", "weak"])


def count_reps_autocorr(signal: np.ndarray, rate_hz: float = 50.0, min_period_s: float = 1.0, max_period_s: float = 8.0) -> float | None:
    """Simple repetition count via autocorrelation (baseline, no model).

    `signal` is a section of a set, e.g. the main component of the gyroscope.
    Returns `None` if there is no clear period.
    """
    x = np.asarray(signal, float)
    x = x[~np.isnan(x)]
    if len(x) < rate_hz * 2 * min_period_s:
        return None
    x = x - x.mean()
    corr = np.correlate(x, x, mode="full")[len(x) - 1 :]
    if corr[0] <= 0:
        return None
    corr = corr / corr[0]
    lo, hi = int(min_period_s * rate_hz), min(int(max_period_s * rate_hz), len(corr) - 1)
    if hi <= lo:
        return None
    lag = lo + int(np.argmax(corr[lo:hi]))
    if corr[lag] < 0.3:
        return None
    return len(x) / lag


def principal_axis(frame: pd.DataFrame, prefix: str = "g") -> np.ndarray:
    """Projection onto the axis with the most movement; makes counting independent of the wrist."""
    data = frame[[prefix + a for a in "xyz"]].to_numpy(float)
    data = data[~np.isnan(data).any(axis=1)]
    if len(data) < 3:
        return np.array([])
    centered = data - data.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    return centered @ vt[0]


def windows(
    sessions: list[Session],
    rate_hz: float = 50.0,
    window_s: float = 4.0,
    hop_s: float = 1.0,
    mirror_left: bool = False,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fixed windows for an exercise model.

    Returns `X` (windows × time × 6 channels), `y` (exercise_id or "pause"), and
    `groups` (session_id, for validation per session). Windows with gaps are
    dropped. With `mirror_left`, the left hand is mirrored across the x-axis so
    that one model learns both sides. Which axis fits depends on how the watch
    is worn — check on one set per side first.
    """
    xs, ys, groups = [], [], []
    size, hop = int(window_s * rate_hz), int(hop_s * rate_hz)
    for session in sessions:
        if not session.has_motion:
            continue
        frame = resample(session, rate_hz)
        bounds = estimate_set_bounds(session, frame, rate_hz)
        exercise = session.sets.set_index("set_id")["exercise_id"].to_dict()
        labels = np.full(len(frame), "pause", dtype=object)
        t = frame["t_ms"].to_numpy()
        for _, b in bounds.iterrows():
            labels[(t >= b["start_ms"]) & (t <= b["end_ms"])] = exercise.get(b["set_id"], "unknown")
        data = frame[CHANNELS].to_numpy(float)
        if mirror_left and session.wrist == "left":
            data[:, [0, 4, 5]] *= -1  # Mirror across x: ax flips, rotation about y and z does too
        for start in range(0, len(frame) - size + 1, hop):
            chunk = data[start : start + size]
            if np.isnan(chunk).any():
                continue
            values, counts = np.unique(labels[start : start + size], return_counts=True)
            xs.append(chunk)
            ys.append(values[np.argmax(counts)])
            groups.append(session.id)
    if not xs:
        return np.empty((0, size, len(CHANNELS))), np.array([]), np.array([])
    return np.stack(xs), np.array(ys), np.array(groups)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("export", help="ZIP exported from the app")
    parser.add_argument("--windows", help="save windows as .npz (X, y, groups)")
    args = parser.parse_args()
    sessions = load_export(args.export)
    for s in sessions:
        done = s.sets.dropna(subset=["completed_ms"]) if "completed_ms" in s.sets else s.sets
        minutes = (s.accel["t_ms"].iloc[-1] - s.accel["t_ms"].iloc[0]) / 60000 if s.has_motion else float("nan")
        bounds = estimate_set_bounds(s) if s.has_motion else pd.DataFrame()
        print(
            f"{s.id}: {len(done)} sets ticked off · "
            + (f"{minutes:.1f} min of motion · {len(bounds)} sets found in the signal" if s.has_motion else "no motion data")
            + ("" if s.clock_aligned else " · clock not aligned")
            + f" · wrist {s.wrist}"
        )
    if args.windows:
        x, y, groups = windows(sessions)
        np.savez_compressed(args.windows, X=x, y=y, groups=groups)
        print(f"{len(x)} windows saved to {args.windows}")


if __name__ == "__main__":
    main()
