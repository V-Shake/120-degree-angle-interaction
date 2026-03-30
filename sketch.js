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

const TARGET_ANGLE = 120;
const THRESHOLD = 5;
const MIN_CONFIDENCE = 0.35;
const GUIDE_LENGTH = 86;
const CYCLE_DURATION = 30; // seconds

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
    name: "The Archer",
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
    name: "The Brisk Walker",
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
    name: "The V-Sign",
    targets: [
      {
        alternatives: [
          { a: "leftWrist", b: "nose", c: "rightWrist" }
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
let matchTextAlpha = 0;

const ANNIVERSARY_TEXT =
  "同济大学建校120周年\n120TH ANNIVERSARY OF TONGJI UNIVERSITY\n1907-2027";

function setup() {
  createCanvas(CANVAS_W, CANVAS_H);

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

  countdownButton = createButton("Stop Countdown");
  countdownButton.position(width - 170, 14);
  countdownButton.size(150, 34);
  countdownButton.mousePressed(toggleCountdown);

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
  drawMatchLabel();
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

  placeGuidesRandomly();
}

function toggleCountdown() {
  countdownActive = !countdownActive;
  countdownButton.html(countdownActive ? "Stop Countdown" : "Start Countdown");

  if (countdownActive) {
    cycleStartTime = millis();
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

  for (let i = 0; i < currentChecks.length; i++) {
    const check = currentChecks[i];
    const target = poseDef.targets[i];

    let best = null;

    for (const alt of target.alternatives) {
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
  text(heroPoses[currentPoseIndex].name, width / 2, 14);

  textSize(18);
  text(countdownActive ? `Next pose in ${remaining.toFixed(1)}s` : "Countdown paused", width / 2, 44);

  textSize(12);
  text("Keys: 1 / 2 / 3 to switch poses", width / 2, 68);
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

function drawMatchLabel() {
  const allMatched = currentChecks.length > 0 && currentChecks.every((c) => c.isMatch);
  const alphaTarget = allMatched ? 255 : 0;
  matchTextAlpha = lerp(matchTextAlpha, alphaTarget, 0.12);

  if (matchTextAlpha < 2) {
    return;
  }

  const firstMatch = currentChecks.find((c) => c.isMatch);
  if (!firstMatch) {
    return;
  }

  textAlign(CENTER, CENTER);
  textSize(24);
  noStroke();
  fill(60, 220, 110, matchTextAlpha);
  text(ANNIVERSARY_TEXT, firstMatch.vertexX, firstMatch.vertexY - 60);
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
