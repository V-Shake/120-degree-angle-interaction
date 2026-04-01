/*
  120 Degree Angle Interaction - Hero Poses Edition
  -------------------------------------------------
  - Vertical canvas
  - Webcam displayed without stretching (contain fit)
  - 3 predefined poses, auto cycle every 30s
  - Keys 1/2/3 to switch pose manually
  - Button to stop/start countdown
  - Green guides on match within +/-5 degrees
  - Anniversary text appears at first matched angle vertex
*/

let video;
let poseNet;
let poses = [];
let canvasRenderer;

const TARGET_ANGLE = 120;
const THRESHOLD = 5;
const MIN_CONFIDENCE = 0.35;
const SILHOUETTE_MIN_CONFIDENCE = 0.14;
const GUIDE_LENGTH = 86;
const CYCLE_DURATION = 30; // seconds
const COUNTDOWN_CIRCLE_R = 38;

// Visual canvas is vertical and larger.
const CANVAS_W = 700;
const CANVAS_H = 1100;

// Camera frame is drawn inside canvas with contain fit, no stretch.
let camDrawX = 0;
let camDrawY = 0;
let camDrawW = 0;
let camDrawH = 0;

// A check supports alternative body-part triplets so no fixed left/right binding.
// Each triplet is angle ABC, where B is vertex.
const heroPoses = [
  {
    name: "The Peak",
    targets: [
      {
        alternatives: [
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" },
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" }
        ]
      },
      {
        alternatives: [
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" },
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" }
        ]
      }
    ]
  },
  {
    name: "The Sprinter",
    targets: [
      {
        alternatives: [
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" },
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" }
        ]
      },
      {
        alternatives: [
          { a: "leftHip", b: "leftKnee", c: "leftAnkle" },
          { a: "rightHip", b: "rightKnee", c: "rightAnkle" }
        ]
      },
      {
        alternatives: [
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" },
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" }
        ]
      }
    ]
  },
  {
    name: "The Horizon",
    targets: [
      {
        alternatives: [
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" },
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" }
        ]
      },
      {
        alternatives: [
          { a: "rightShoulder", b: "rightElbow", c: "rightWrist" },
          { a: "leftShoulder", b: "leftElbow", c: "leftWrist" }
        ]
      }
    ]
  }
];

let currentPoseIndex = 0;
let currentChecks = [];
let countdownActive = true;
let cycleStartTime = 0;
let countdownButton;
let silhouetteButton;
let visualMode = 0; // 0=skeleton, 1=silhouette, 2=hybrid
let successOverlayAlpha = 0;
let stableAllMatchedFrames = 0;
let successLatched = false;
const REQUIRED_MATCH_FRAMES = 6;

function setup() {
  canvasRenderer = createCanvas(CANVAS_W, CANVAS_H);

  // Camera at 4:3. We render it with contain fit to avoid stretching.
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  poseNet = ml5.poseNet(video, () => {
    console.log("PoseNet ready");
  });

  poseNet.on("pose", (results) => {
    poses = results;
  });

  angleMode(DEGREES);
  textAlign(CENTER, CENTER);

  countdownButton = createButton("⏸");
  countdownButton.size(48, 34);
  countdownButton.style("font-size", "18px");
  countdownButton.style("padding", "0");
  countdownButton.style("line-height", "1");
  countdownButton.style("display", "flex");
  countdownButton.style("align-items", "center");
  countdownButton.style("justify-content", "center");
  countdownButton.style("text-align", "center");
  countdownButton.mousePressed(toggleCountdown);

  silhouetteButton = createButton("Visual: Skeleton");
  silhouetteButton.size(170, 34);
  silhouetteButton.style("font-size", "14px");
  silhouetteButton.style("padding", "0 10px");
  silhouetteButton.mousePressed(toggleSilhouetteMode);

  positionCountdownButton();

  cycleStartTime = millis();
  initializePoseChecks();
}

function draw() {
  background(10);
  updateCountdown();

  drawMirroredVideoContain();

  const pose = poses.length > 0 ? poses[0].pose : null;

  if (pose) {
    updateAngleChecks(pose);
    if (visualMode >= 1) {
      drawBodyMask(pose);
    }
    if (visualMode === 2) {
      drawPatternAccents(pose);
    }

    // Keep skeleton lines visible in white in all modes.
    drawUserSilhouette(pose);
  } else {
    for (const check of currentChecks) {
      check.angle = null;
      check.isMatch = false;
      check.transition = lerp(check.transition, 0, 0.08);
    }
  }

  drawReferenceGuides();
  drawHeader();
  drawAngleReadout();
  drawSuccessOverlay();
}

function drawMirroredVideoContain() {
  const srcW = video.width || 640;
  const srcH = video.height || 480;

  const scaleFactor = min(width / srcW, height / srcH);
  camDrawW = srcW * scaleFactor;
  camDrawH = srcH * scaleFactor;
  camDrawX = (width - camDrawW) / 2;
  camDrawY = (height - camDrawH) / 2;

  // Subtle frame region to show the active camera area.
  noFill();
  stroke(255, 50);
  strokeWeight(1);
  rect(camDrawX, camDrawY, camDrawW, camDrawH);

  push();
  translate(camDrawX + camDrawW, camDrawY);
  scale(-1, 1);
  image(video, 0, 0, camDrawW, camDrawH);
  pop();
}

function initializePoseChecks() {
  const pose = heroPoses[currentPoseIndex];
  stableAllMatchedFrames = 0;
  successOverlayAlpha = 0;
  successLatched = false;

  currentChecks = pose.targets.map(() => ({
    angle: null,
    isMatch: false,
    transition: 0,
    guideX: 0,
    guideY: 0,
    guideRotationDeg: 0,
    vertexX: width / 2,
    vertexY: height / 2
  }));

  if (pose.name === "The Archer" && currentChecks.length >= 2) {
    // Archer guide 1: fixed top-left, opening toward left side.
    currentChecks[0].guideX = 215;
    currentChecks[0].guideY = 420;
    currentChecks[0].guideRotationDeg = 300;

    // Archer guide 2: fixed bottom-right, opening toward right side.
    currentChecks[1].guideX = width - 185;
    currentChecks[1].guideY = height - 420;
    currentChecks[1].guideRotationDeg = 130;
    return;
  }

  if (pose.name === "The Brisk Walker" && currentChecks.length >= 3) {
    // Brisk Walker guide 1: upper-right arm target.
    currentChecks[0].guideX = width - 210;
    currentChecks[0].guideY = 500;
    currentChecks[0].guideRotationDeg = 80;

    // Brisk Walker guide 2: lower-middle leg target.
    currentChecks[1].guideX = width - 410;
    currentChecks[1].guideY = height - 420;
    currentChecks[1].guideRotationDeg = 335;

    // Brisk Walker guide 3: middle-left arm target.
    currentChecks[2].guideX = 190;
    currentChecks[2].guideY = 540;
    currentChecks[2].guideRotationDeg = 260;
    return;
  }

  if (pose.name === "The V-Sign" && currentChecks.length >= 1) {
    // V-Sign guide 1: fixed upper-left target.
    currentChecks[0].guideX = 210;
    currentChecks[0].guideY = 600;
    currentChecks[0].guideRotationDeg = 240;

    // V-Sign guide 2: fixed upper-right target.
    currentChecks[1].guideX = width - 210;
    currentChecks[1].guideY = 620;
    currentChecks[1].guideRotationDeg = 190;
    return;
  }

  placeGuidesRandomly();
}

function toggleCountdown() {
  countdownActive = !countdownActive;
  countdownButton.html(countdownActive ? "⏸" : "▶");

  if (countdownActive) {
    cycleStartTime = millis();
  }
}

function toggleSilhouetteMode() {
  visualMode = (visualMode + 1) % 3;

  if (visualMode === 0) {
    silhouetteButton.html("Visual: Skeleton");
  } else if (visualMode === 1) {
    silhouetteButton.html("Visual: Silhouette");
  } else {
    silhouetteButton.html("Visual: Hybrid");
  }
}

function updateCountdown() {
  if (!countdownActive) {
    return;
  }

  const elapsed = (millis() - cycleStartTime) / 1000;
  if (elapsed >= CYCLE_DURATION) {
    currentPoseIndex = (currentPoseIndex + 1) % heroPoses.length;
    initializePoseChecks();
    cycleStartTime = millis();
  }
}

function keyPressed() {
  if (key === "1") {
    currentPoseIndex = 0;
  } else if (key === "2") {
    currentPoseIndex = 1;
  } else if (key === "3") {
    currentPoseIndex = 2;
  } else {
    return;
  }

  initializePoseChecks();
  cycleStartTime = millis();
}

function updateAngleChecks(pose) {
  const poseDef = heroPoses[currentPoseIndex];
  const usedAlternativeKeys = new Set();

  for (let i = 0; i < currentChecks.length; i++) {
    const check = currentChecks[i];
    const target = poseDef.targets[i];

    let best = null;

    for (const alt of target.alternatives) {
      const altKey = `${alt.a}|${alt.b}|${alt.c}`;
      if (usedAlternativeKeys.has(altKey)) {
        continue;
      }

      const pA = getKeypointByName(pose, alt.a);
      const pB = getKeypointByName(pose, alt.b);
      const pC = getKeypointByName(pose, alt.c);

      if (
        pA &&
        pB &&
        pC &&
        pA.score > MIN_CONFIDENCE &&
        pB.score > MIN_CONFIDENCE &&
        pC.score > MIN_CONFIDENCE
      ) {
        const angleValue = calculateAngleDegrees(
          pA.position,
          pB.position,
          pC.position
        );

        const error = abs(angleValue - TARGET_ANGLE);
        if (!best || error < best.error) {
          best = {
            angle: angleValue,
            error,
            altKey,
            vertexX: mirrorAndMapX(pB.position.x),
            vertexY: mapYToCanvas(pB.position.y)
          };
        }
      }
    }

    if (best) {
      check.angle = best.angle;
      check.isMatch = best.error <= THRESHOLD;
      check.vertexX = best.vertexX;
      check.vertexY = best.vertexY;
      usedAlternativeKeys.add(best.altKey);
    } else {
      check.angle = null;
      check.isMatch = false;
    }

    const targetTransition = check.isMatch ? 1 : 0;
    check.transition = lerp(check.transition, targetTransition, 0.12);
  }
}

function drawReferenceGuides() {
  for (const check of currentChecks) {
    const inactive = color(255);
    const active = color(60, 220, 110);
    const guideColor = lerpColor(inactive, active, check.transition);

    drawAngleGuide(
      check.guideX,
      check.guideY,
      GUIDE_LENGTH,
      TARGET_ANGLE,
      check.guideRotationDeg,
      guideColor
    );
  }
}

function placeGuidesRandomly() {
  const marginX = GUIDE_LENGTH + 24;
  const minY = 170;
  const maxY = height - 130;
  const minDistance = 180;

  for (let i = 0; i < currentChecks.length; i++) {
    let placed = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const candidateX = random(marginX, width - marginX);
      const candidateY = random(minY, maxY);

      let tooClose = false;
      for (let j = 0; j < i; j++) {
        const d = dist(
          candidateX,
          candidateY,
          currentChecks[j].guideX,
          currentChecks[j].guideY
        );

        if (d < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        currentChecks[i].guideX = candidateX;
        currentChecks[i].guideY = candidateY;
        currentChecks[i].guideRotationDeg = random(-40, 40);
        placed = true;
        break;
      }
    }

    if (!placed) {
      currentChecks[i].guideX = map(
        i,
        0,
        max(1, currentChecks.length - 1),
        marginX,
        width - marginX
      );
      currentChecks[i].guideY = map(
        i,
        0,
        max(1, currentChecks.length - 1),
        minY,
        maxY
      );
      currentChecks[i].guideRotationDeg = random(-40, 40);
    }
  }
}

function drawAngleGuide(x, y, lineLength, angleDeg, rotationDeg, lineColor) {
  push();
  translate(x, y);
  rotate(rotationDeg);

  stroke(lineColor);
  strokeWeight(9);
  strokeCap(ROUND);

  line(0, 0, lineLength, 0);

  const x2 = lineLength * cos(angleDeg);
  const y2 = lineLength * sin(angleDeg);
  line(0, 0, x2, y2);

  pop();
}

function drawUserSilhouette(pose) {
  const links = [
    ["leftShoulder", "rightShoulder"],
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftWrist"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightWrist"],
    ["leftShoulder", "leftHip"],
    ["rightShoulder", "rightHip"],
    ["leftHip", "rightHip"],
    ["leftHip", "leftKnee"],
    ["leftKnee", "leftAnkle"],
    ["rightHip", "rightKnee"],
    ["rightKnee", "rightAnkle"]
  ];

  stroke(255, 220);
  strokeWeight(3);

  for (const [startName, endName] of links) {
    const start = getKeypointByName(pose, startName);
    const end = getKeypointByName(pose, endName);

    if (
      start &&
      end &&
      start.score > MIN_CONFIDENCE &&
      end.score > MIN_CONFIDENCE
    ) {
      line(
        mirrorAndMapX(start.position.x),
        mapYToCanvas(start.position.y),
        mirrorAndMapX(end.position.x),
        mapYToCanvas(end.position.y)
      );
    }
  }

  noStroke();
  fill(255);

  for (const point of pose.keypoints) {
    if (point.score > MIN_CONFIDENCE) {
      circle(mirrorAndMapX(point.position.x), mapYToCanvas(point.position.y), 8);
    }
  }
}

function drawHeader() {
  const elapsed = (millis() - cycleStartTime) / 1000;
  const remaining = countdownActive ? max(0, CYCLE_DURATION - elapsed) : 0;

  fill(255);
  noStroke();
  textAlign(CENTER, TOP);
  textSize(22);
  text(heroPoses[currentPoseIndex].name, width / 2, 56);

  textSize(12);
  text("Keys: 1 / 2 / 3 to switch poses", width / 2, 84);

  drawCountdownCircle(remaining);
  positionCountdownButton();
}

function positionCountdownButton() {
  if (!canvasRenderer || !countdownButton || !silhouetteButton) {
    return;
  }

  const rect = canvasRenderer.elt.getBoundingClientRect();
  const circleCenterX = width - 70;
  const circleBottomY = 62 + COUNTDOWN_CIRCLE_R;
  const btnW = 48;
  const btnGap = 12;
  const silhouetteW = 170;

  countdownButton.position(
    rect.left + circleCenterX - btnW / 2,
    rect.top + circleBottomY + btnGap
  );

  silhouetteButton.position(
    rect.left + width / 2 - silhouetteW / 2,
    rect.top + 12
  );
}

function drawBodyMask(pose) {
  const ls = getMappedKeypoint(pose, "leftShoulder", SILHOUETTE_MIN_CONFIDENCE);
  const rs = getMappedKeypoint(pose, "rightShoulder", SILHOUETTE_MIN_CONFIDENCE);
  const lh = getMappedKeypoint(pose, "leftHip", SILHOUETTE_MIN_CONFIDENCE);
  const rh = getMappedKeypoint(pose, "rightHip", SILHOUETTE_MIN_CONFIDENCE);

  const bodyAnchorNames = [
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftHip",
    "rightHip",
    "leftKnee",
    "rightKnee"
  ];
  let detectedBodyAnchors = 0;
  for (const name of bodyAnchorNames) {
    if (getMappedKeypoint(pose, name, SILHOUETTE_MIN_CONFIDENCE)) {
      detectedBodyAnchors += 1;
    }
  }

  // Avoid rendering a face-only blob when body tracking is weak.
  if (detectedBodyAnchors < 4) {
    return;
  }

  noStroke();
  fill(0, 210);

  // Torso polygon creates a stable central body mass.
  if (ls && rs && rh && lh) {
    beginShape();
    vertex(ls.x, ls.y);
    vertex(rs.x, rs.y);
    vertex(rh.x, rh.y);
    vertex(lh.x, lh.y);
    endShape(CLOSE);
  }

  drawSilhouetteLimb(pose, "leftShoulder", "leftElbow", 44, 34);
  drawSilhouetteLimb(pose, "leftElbow", "leftWrist", 34, 24);
  drawSilhouetteLimb(pose, "rightShoulder", "rightElbow", 44, 34);
  drawSilhouetteLimb(pose, "rightElbow", "rightWrist", 34, 24);

  drawSilhouetteLimb(pose, "leftHip", "leftKnee", 52, 42);
  drawSilhouetteLimb(pose, "leftKnee", "leftAnkle", 42, 30);
  drawSilhouetteLimb(pose, "rightHip", "rightKnee", 52, 42);
  drawSilhouetteLimb(pose, "rightKnee", "rightAnkle", 42, 30);

  // Neck / shoulder bridge improves silhouette continuity.
  drawSilhouetteLimb(pose, "leftShoulder", "rightShoulder", 30, 30);

  // Draw head only when enough anchor points exist.
  drawHeadSilhouette(pose, ls, rs);
}

function drawPatternAccents(pose) {
  const accentJoints = [
    ["leftShoulder", "leftElbow"],
    ["rightShoulder", "rightElbow"],
    ["leftElbow", "leftWrist"],
    ["rightElbow", "rightWrist"],
    ["leftHip", "leftKnee"],
    ["rightHip", "rightKnee"],
    ["leftKnee", "leftAnkle"],
    ["rightKnee", "rightAnkle"]
  ];

  for (let i = 0; i < accentJoints.length; i++) {
    // Sparse twinkle effect so accents stay clean and not too dense.
    if ((frameCount + i * 5) % 18 > 10) {
      continue;
    }

    const [jointName, refName] = accentJoints[i];
    const joint = getMappedKeypoint(pose, jointName, MIN_CONFIDENCE);
    const ref = getMappedKeypoint(pose, refName, MIN_CONFIDENCE);

    if (!joint || !ref) {
      continue;
    }

    const base = atan2(ref.y - joint.y, ref.x - joint.x);
    const len = 22 + ((i * 7) % 9);

    // Soft glow underlay.
    stroke(120, 255, 245, 70);
    strokeWeight(5);
    strokeCap(ROUND);
    draw120Motif(joint.x, joint.y, base, len);

    // Crisp accent line.
    stroke(235, 255, 255, 210);
    strokeWeight(2.2);
    draw120Motif(joint.x, joint.y, base, len);
  }
}

function draw120Motif(x, y, baseAngle, length) {
  const x1 = x + cos(baseAngle) * length;
  const y1 = y + sin(baseAngle) * length;
  line(x, y, x1, y1);

  const second = baseAngle + radians(120);
  const x2 = x + cos(second) * length;
  const y2 = y + sin(second) * length;
  line(x, y, x2, y2);
}

function drawSilhouetteLimb(pose, startName, endName, startWidth, endWidth) {
  const start = getMappedKeypoint(pose, startName, SILHOUETTE_MIN_CONFIDENCE);
  const end = getMappedKeypoint(pose, endName, SILHOUETTE_MIN_CONFIDENCE);
  if (!start || !end) {
    return;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    return;
  }

  const nx = -dy / len;
  const ny = dx / len;
  const s = startWidth * 0.5;
  const e = endWidth * 0.5;

  noStroke();
  fill(0, 215);

  beginShape();
  vertex(start.x + nx * s, start.y + ny * s);
  vertex(end.x + nx * e, end.y + ny * e);
  vertex(end.x - nx * e, end.y - ny * e);
  vertex(start.x - nx * s, start.y - ny * s);
  endShape(CLOSE);

  // Round caps for smoother organic silhouette.
  ellipse(start.x, start.y, startWidth, startWidth);
  ellipse(end.x, end.y, endWidth, endWidth);
}

function drawHeadSilhouette(pose, leftShoulder, rightShoulder) {
  const nose = getMappedKeypoint(pose, "nose", SILHOUETTE_MIN_CONFIDENCE);
  const leftEar = getMappedKeypoint(pose, "leftEar", SILHOUETTE_MIN_CONFIDENCE);
  const rightEar = getMappedKeypoint(pose, "rightEar", SILHOUETTE_MIN_CONFIDENCE);
  const leftEye = getMappedKeypoint(pose, "leftEye", SILHOUETTE_MIN_CONFIDENCE);
  const rightEye = getMappedKeypoint(pose, "rightEye", SILHOUETTE_MIN_CONFIDENCE);

  // Avoid a lone face blob when body anchors are missing.
  if (!nose || !leftShoulder || !rightShoulder) {
    return;
  }

  // Require at least one lateral face anchor for stable head sizing.
  if (!(leftEar && rightEar) && !(leftEye && rightEye)) {
    return;
  }

  let headW;
  if (leftEar && rightEar) {
    headW = dist(leftEar.x, leftEar.y, rightEar.x, rightEar.y) * 1.45;
  } else if (leftEye && rightEye) {
    headW = dist(leftEye.x, leftEye.y, rightEye.x, rightEye.y) * 2.7;
  } else {
    headW = dist(leftShoulder.x, leftShoulder.y, rightShoulder.x, rightShoulder.y) * 0.42;
  }

  headW = constrain(headW, 58, 135);
  const headH = headW * 1.22;

  noStroke();
  fill(0, 220);
  ellipse(nose.x, nose.y - headH * 0.12, headW, headH);
}

function getMappedKeypoint(pose, name, minScore = MIN_CONFIDENCE) {
  const kp = getKeypointByName(pose, name);
  if (!kp || kp.score <= minScore) {
    return null;
  }

  return {
    x: mirrorAndMapX(kp.position.x),
    y: mapYToCanvas(kp.position.y)
  };
}

function drawCountdownCircle(remaining) {
  const cx = width - 70;
  const cy = 62;
  const d = COUNTDOWN_CIRCLE_R * 2;
  const progress = constrain(remaining / CYCLE_DURATION, 0, 1);

  push();
  angleMode(DEGREES);

  // Background ring.
  noFill();
  stroke(255, 70);
  strokeWeight(7);
  circle(cx, cy, d);

  // Progress ring, starts from top and goes clockwise.
  stroke(countdownActive ? color(60, 220, 110) : color(180));
  strokeWeight(8);
  strokeCap(ROUND);
  arc(cx, cy, d, d, -90, -90 + progress * 360);

  // Numeric value in center.
  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(16);
  text(`${ceil(remaining)}s`, cx, cy - 2);

  textSize(10);
  fill(220);
  text(countdownActive ? "NEXT" : "PAUSED", cx, cy + 14);
  pop();
}

function drawAngleReadout() {
  fill(255);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(14);

  let y = 94;
  for (const check of currentChecks) {
    const valueText = check.angle === null ? "--" : `${nf(check.angle, 0, 1)} deg`;
    const status = check.isMatch ? "OK" : "...";
    text(`Target 120 deg: ${valueText} (${status})`, 16, y);
    y += 22;
  }
}

function drawSuccessOverlay() {
  const allMatchedNow =
    currentChecks.length > 0 &&
    currentChecks.every((c) => c.angle !== null && c.isMatch);

  // Allow small PoseNet jitter: build up when matched, decay when not.
  if (allMatchedNow) {
    stableAllMatchedFrames = min(REQUIRED_MATCH_FRAMES, stableAllMatchedFrames + 1);
  } else {
    stableAllMatchedFrames = max(0, stableAllMatchedFrames - 1);
  }

  const allMatched = stableAllMatchedFrames >= REQUIRED_MATCH_FRAMES;
  if (allMatched) {
    successLatched = true;
  }

  const alphaTarget = successLatched ? 235 : 0;
  successOverlayAlpha = lerp(successOverlayAlpha, alphaTarget, 0.12);

  if (successOverlayAlpha < 2) {
    return;
  }

  noStroke();
  fill(10, 10, 10, successOverlayAlpha);
  rect(0, 0, width, height);

  textAlign(CENTER, CENTER);
  textSize(56);
  noStroke();
  fill(60, 220, 110, successOverlayAlpha);
  text("MATCHES!", width / 2, height / 2 - 35);

  textSize(24);
  fill(255, successOverlayAlpha);
  text(
    "You can see on your phone the successful moment.",
    width / 2,
    height / 2 + 30
  );
}

function calculateAngleDegrees(pointA, pointB, pointC) {
  const baX = pointA.x - pointB.x;
  const baY = pointA.y - pointB.y;
  const bcX = pointC.x - pointB.x;
  const bcY = pointC.y - pointB.y;

  const dot = baX * bcX + baY * bcY;
  const magnitudeBA = Math.hypot(baX, baY);
  const magnitudeBC = Math.hypot(bcX, bcY);

  if (magnitudeBA === 0 || magnitudeBC === 0) {
    return 0;
  }

  const cosineValue = constrain(dot / (magnitudeBA * magnitudeBC), -1, 1);
  return acos(cosineValue);
}

function getKeypointByName(pose, name) {
  return pose.keypoints.find((kp) => kp.part === name);
}

function mirrorAndMapX(videoX) {
  // Mirror in video space first, then map into contain-fitted draw area.
  const mirrored = video.width - videoX;
  return camDrawX + (mirrored / video.width) * camDrawW;
}

function mapYToCanvas(videoY) {
  return camDrawY + (videoY / video.height) * camDrawH;
}
