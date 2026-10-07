"""Prüft runback_motion.py an einem künstlichen Export im App-Format.

    python -m unittest tools/motion/test_runback_motion.py
"""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import runback_motion as rm  # noqa: E402

RATE = 50
# Zwei Sätze Curls: 10 und 8 Wiederholungen à 2,5 s, abgehakt einige Sekunden danach.
SETS = [(30_000, 10, 4_000), (119_000, 8, 3_000)]


def _imu() -> tuple[str, str]:
    rng = np.random.default_rng(7)
    t = np.arange(0, 180_000, 1000 / RATE)
    g = np.zeros_like(t)
    for start, reps, _ in SETS:
        inside = (t >= start) & (t < start + reps * 2_500)
        g[inside] = 2 * np.sin(2 * np.pi * (t[inside] - start) / 2_500)
    noise = lambda: rng.normal(0, 0.03, len(t))  # noqa: E731
    accel = np.column_stack([t, 0.5 + noise(), -9.8 + g + noise(), noise()])
    gyro = np.column_stack([t, g + noise(), 0.2 * g + noise(), noise()])
    as_csv = lambda rows: "t_ms,x,y,z\n" + "\n".join(",".join(f"{v:g}" for v in row) for row in rows) + "\n"  # noqa: E731
    return as_csv(accel), as_csv(gyro)


def _export(path: Path, root: str = "") -> None:
    accel, gyro = _imu()
    sets = ["exercise_index,exercise_id,exercise_name,set_index,set_id,set_kind,load_kind,planned_reps,planned_weight_kg,"
            "planned_seconds,reps,weight_kg,seconds,rir,skipped,completed_ms,rest_seconds"]
    for i, (start, reps, lag) in enumerate(SETS):
        sets.append(f"0,biceps_curl,Bizepscurls,{i},c{i + 1},normal,kg,{reps},12,,{reps},12,,,0,{start + reps * 2_500 + lag},60")
    sets.append("0,biceps_curl,Bizepscurls,2,c3,normal,kg,8,12,,,,,,0,,60")
    with zipfile.ZipFile(path, "w") as archive:
        if root:
            # Krafttraining-Export: eigene Tabellen gleichen Namens auf oberster Ebene.
            archive.writestr("sessions.csv", "session_id,start_utc\nandere,2026-10-04\n")
        archive.writestr(f"{root}manifest.json", json.dumps({"format": rm.EXPORT_FORMAT, "formatVersion": 1}))
        archive.writestr(f"{root}sessions.csv", "session_id\nsession-demo\n")
        archive.writestr(f"{root}session-demo/meta.json", json.dumps({"wrist": "right", "clock": {"offsetMs": 180}}))
        archive.writestr(f"{root}session-demo/accel.csv", accel)
        archive.writestr(f"{root}session-demo/gyro.csv", gyro)
        archive.writestr(f"{root}session-demo/sets.csv", "\n".join(sets) + "\n")
        archive.writestr(f"{root}session-demo/events.csv", "t_ms,event\n0,session_started\n")


class RunbackMotionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.path = Path(cls.dir.name) / "export.zip"
        _export(cls.path)
        cls.session = rm.load_export(cls.path)[0]

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_unchecked_set_stays_unknown(self):
        self.assertTrue(np.isnan(self.session.sets.loc[2, "completed_ms"]))
        self.assertTrue(np.isnan(self.session.sets.loc[2, "reps"]))

    def test_set_bounds_end_before_check_and_cover_the_reps(self):
        bounds = rm.estimate_set_bounds(self.session)
        self.assertEqual(list(bounds["set_id"]), ["c1", "c2"])
        for (_, b), (start, reps, _) in zip(bounds.iterrows(), SETS):
            self.assertAlmostEqual(b["start_ms"], start, delta=1_500)
            self.assertAlmostEqual(b["end_ms"], start + reps * 2_500, delta=1_500)

    def test_sets_ticked_seconds_apart_are_weak_labels(self):
        self.assertEqual(list(self.session.sets["label"]), ["single", "single", ""])
        late = self.session.sets.drop(columns="label")
        late.loc[1, "completed_ms"] = late.loc[0, "completed_ms"] + 2_000
        batch = rm.Session("x", {}, self.session.accel, self.session.gyro, late, self.session.events)
        rm._add_labels(batch)
        self.assertEqual(list(batch.sets["label"]), ["batch", "batch", ""])
        self.assertTrue(rm.estimate_set_bounds(batch)["weak"].all())

    def test_autocorrelation_counts_reps(self):
        frame = rm.resample(self.session)
        for (_, b), (_, reps, _) in zip(rm.estimate_set_bounds(self.session, frame).iterrows(), SETS):
            part = frame[(frame.t_ms >= b["start_ms"]) & (frame.t_ms <= b["end_ms"])]
            self.assertEqual(round(rm.count_reps_autocorr(rm.principal_axis(part))), reps)

    def test_windows_are_grouped_by_session(self):
        x, y, groups = rm.windows([self.session])
        self.assertEqual(x.shape[1:], (200, 6))
        self.assertIn("biceps_curl", set(y))
        self.assertEqual(set(groups), {"session-demo"})

    def test_reads_the_folder_inside_the_strength_export(self):
        path = Path(self.dir.name) / "kraft.zip"
        _export(path, rm.STRENGTH_EXPORT_DIRECTORY)
        sessions = rm.load_export(path)
        self.assertEqual([s.id for s in sessions], ["session-demo"])
        self.assertEqual(len(sessions[0].accel), len(self.session.accel))

    def test_rejects_other_zip(self):
        other = Path(self.dir.name) / "other.zip"
        with zipfile.ZipFile(other, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"format": "x"}))
        with self.assertRaises(ValueError):
            rm.load_export(other)


if __name__ == "__main__":
    unittest.main()
