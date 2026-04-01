# 120-Degree Angle Interaction

Interactive pose-matching experience built with p5.js + ml5 PoseNet.

The sketch tracks your body from webcam input and asks you to match 120-degree joint angles in a set of poses.

## Features

- Mirrored webcam feed drawn with contain fit
- PoseNet-based body tracking
- 3 pose presets that auto-cycle every 30 seconds
- Real-time angle checks against a 120-degree target
- Match tolerance of +-5 degrees
- Success overlay when all targets are matched consistently

## Controls

- `1` / `2` / `3`: switch pose preset manually
- Top-right button (`pause/play`): stop or resume auto-cycle countdown

## Project Structure

- `index.html` - loads p5.js, ml5, and the sketch
- `sketch.js` - pose logic, rendering, UI, and interaction flow

## Run Locally

Because webcam APIs are usually blocked on `file://`, run the project from a local web server.

### Option A: VS Code Live Server

1. Install the Live Server extension (if needed).
2. Open `index.html`.
3. Start Live Server.
4. Allow camera permission in the browser.

### Option B: Python HTTP server

From the project folder, run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Grant webcam permission when prompted.

## Notes

- Pose quality depends on lighting and full-body visibility.
- If tracking is unstable, step back so more of your body is visible.
- Best results are usually in a bright environment with clear contrast.
