"""Sample data for the website screenshots (site/shots).

Generates eight weeks of runs as GPX (track, heart rate, cadence) on real routes in
Hamburg and strength sessions in Strong CSV format, packed as runback-demo.zip.
In the app, the ZIP is imported under Settings › Your data › From other apps ›
Strong. The routes come once from OSRM foot routing (OpenStreetMap data). The values
are invented and only meant for screenshots.

    python3 tools/site-demo/gen.py [ausgabeordner]
"""
import json, math, random, datetime as dt, zipfile, os, sys, urllib.request

random.seed(7)
OUT = sys.argv[1] if len(sys.argv) > 1 else 'site-demo-out'
TZ = dt.timezone(dt.timedelta(hours=2))

WAYPOINTS = {
    'stadtpark': '10.0105,53.5978;10.0215,53.5995;10.0330,53.5985;10.0335,53.5930;10.0200,53.5918;10.0105,53.5978',
    'alster': '10.0005,53.5655;10.0080,53.5745;10.0130,53.5650;10.0045,53.5590;10.0005,53.5655',
    'lang': '10.0045,53.5590;10.0005,53.5655;10.0080,53.5745;10.0215,53.5995;10.0335,53.5930;10.0130,53.5650;10.0045,53.5590',
}

def load(name):
    cache = os.path.join(OUT, f'route-{name}.json')
    if not os.path.exists(cache):
        os.makedirs(OUT, exist_ok=True)
        url = ('https://routing.openstreetmap.de/routed-foot/route/v1/driving/'
               f'{WAYPOINTS[name]}?overview=full&geometries=geojson')
        with urllib.request.urlopen(url) as r, open(cache, 'wb') as f:
            f.write(r.read())
    c = json.load(open(cache))['routes'][0]['geometry']['coordinates']
    return [(lat, lon) for lon, lat in c]

def hav(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

ROUTES = {}
for n in ('stadtpark', 'alster', 'lang'):
    pts = load(n)
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + hav(pts[i-1], pts[i]))
    ROUTES[n] = (pts, cum)

def at(route, d):
    pts, cum = ROUTES[route]
    d = min(d, cum[-1])
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] <= d: lo = mid
        else: hi = mid
    seg = cum[hi] - cum[lo] or 1
    t = (d - cum[lo]) / seg
    a, b = pts[lo], pts[hi]
    return a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t

def ele(route, d):
    return 12 + 4*math.sin(d/700) + 2*math.sin(d/230 + (1 if route == 'alster' else 0))

def run_gpx(route, title, start, pace, hr0, hr1, cad, fade=0.0):
    """pace in s/km; fade: share by which the second half gets slower."""
    total = ROUTES[route][1][-1]
    t, d = 0.0, 0.0
    hr = hr0 - 25
    rows = []
    noise = 0.0
    while d < total:
        frac = d / total
        p = pace * (1 + (fade * (frac - 0.5) * 2 if frac > 0.5 else 0)) * (1.04 if t < 120 else 1.0)
        noise = 0.97*noise + random.gauss(0, 0.0035)
        speed = 1000.0 / (p * (1 + noise))
        target = hr0 + (hr1 - hr0) * frac
        hr += (target - hr) * 0.03 + random.gauss(0, 0.5)
        lat, lon = at(route, d)
        lat += random.gauss(0, 0.0000015); lon += random.gauss(0, 0.0000025)
        c = cad + random.gauss(0, 1.5) + (2 if speed > 3.6 else 0)
        rows.append((start + dt.timedelta(seconds=t), lat, lon, ele(route, d), round(hr), round(c)))
        t += 2; d += speed * 2
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<gpx version="1.1" creator="Demo" xmlns="http://www.topografix.com/GPX/1/1" '
           'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
           f'<trk><name>{title}</name><type>running</type><trkseg>']
    for (tm, lat, lon, e, h, c) in rows:
        out.append(f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{e:.1f}</ele>'
                   f'<time>{tm.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}</time>'
                   f'<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{h}</gpxtpx:hr>'
                   f'<gpxtpx:cad>{c}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>')
    out.append('</trkseg></trk></gpx>')
    return '\n'.join(out), t

first = dt.date(2026, 8, 10)
last = dt.date(2026, 10, 6)
days = (last - first).days + 1
files = {}
strong = ['"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"']
wn = 0
PUSH = [('Bench Press (Barbell)', 60, 8, 1.25), ('Overhead Press (Barbell)', 35, 8, 0.6),
        ('Lateral Raise (Dumbbell)', 8, 12, 0.15), ('Triceps Pushdown (Cable)', 25, 12, 0.4)]
PULL = [('Lat Pulldown (Cable)', 50, 10, 0.8), ('Seated Row (Cable)', 45, 10, 0.8),
        ('Bicep Curl (Dumbbell)', 12, 10, 0.2), ('Face Pull (Cable)', 20, 15, 0.3)]
LEGS = [('Squat (Barbell)', 70, 6, 1.6), ('Romanian Deadlift (Barbell)', 60, 8, 1.2),
        ('Leg Press', 120, 10, 2.5), ('Calf Raise (Machine)', 50, 12, 0.6)]
gym_cycle = [('Oberkörper Drücken', PUSH), ('Oberkörper Ziehen', PULL), ('Beine', LEGS)]
gi = 0
for i in range(days):
    day = first + dt.timedelta(days=i)
    wd = day.weekday()
    week = i / 7
    if wd in (0, 2, 4) or (wd == 3 and i % 2 == 0):
        pace = 302 - week * 2.6 + random.gauss(0, 3)  # 5:02 → ~4:42
        start = dt.datetime.combine(day, dt.time(7, 5 + random.randint(0, 20)), TZ)
        gpx, _ = run_gpx('stadtpark', 'Stadtpark-Runde', start, pace, 168, 181, 174, fade=0.03)
        files[f'activities/{day:%Y%m%d}_stadtpark.gpx'] = gpx
    if wd == 5:
        start = dt.datetime.combine(day, dt.time(9, 30), TZ)
        gpx, _ = run_gpx('alster', 'Alsterrunde', start, 372 + random.gauss(0, 5), 138, 147, 166, fade=0.01)
        files[f'activities/{day:%Y%m%d}_alster.gpx'] = gpx
    if wd == 6 and i % 14 == 6:
        start = dt.datetime.combine(day, dt.time(9, 0), TZ)
        gpx, _ = run_gpx('lang', 'Lange Runde', start, 384 + random.gauss(0, 6), 140, 158, 165, fade=0.05)
        files[f'activities/{day:%Y%m%d}_lang.gpx'] = gpx
    if wd in (1, 3, 6) and not (wd == 6 and i % 14 == 6):
        name, exs = gym_cycle[gi % 3]; gi += 1
        wn += 1
        start = dt.datetime.combine(day, dt.time(18, 15 + random.randint(0, 25)))
        nsets = 0
        rows = []
        for ex, w0, reps, inc in exs:
            w = w0 + inc * week
            step = 2.5 if w0 >= 20 else 1.0
            w = round(w / step) * step
            for s in range(1, 4 + (1 if w0 >= 50 else 0)):
                r = reps - (1 if s >= 3 and random.random() < 0.5 else 0)
                rows.append((ex, str(s), f'{w:.1f}', str(r), ''))
                rows.append((ex, 'Rest Timer', '', '', '120.0' if w0 < 50 else '180.0'))
                nsets += 1
        dur = 35*60 + nsets * 150 + random.randint(-120, 240)
        for ex, so, wt, rp, sec in rows:
            strong.append(';'.join(f'"{v}"' for v in [str(wn), start.strftime('%Y-%m-%d %H:%M:%S'), name, str(dur), ex, so, wt, rp, '', '', sec, '', '']))
files['strong.csv'] = '\n'.join(strong) + '\n'

os.makedirs(OUT, exist_ok=True)
with zipfile.ZipFile(f'{OUT}/runback-demo.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for k, v in files.items():
        z.writestr(k, v)
print(len([k for k in files if k.endswith('.gpx')]), 'runs,', wn, 'gym sessions,', os.path.getsize(f'{OUT}/runback-demo.zip')//1024, 'KB')
