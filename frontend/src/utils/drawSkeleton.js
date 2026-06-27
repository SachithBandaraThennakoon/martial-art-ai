export function drawSkeleton(canvas, poseLandmarks, handLandmarksList) {
  if (!canvas || !poseLandmarks) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = "black";
  ctx.fillStyle = "black";
  ctx.lineCap = "round";

  const toXY = (p) => ({
    x: p.x * w,
    y: p.y * h
  });

  const drawBone = (a, b, thickness = 4) => {
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  };

  const drawJoint = (p, size = 3) => {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
    ctx.fill();
  };

  // =========================
  // BODY
  // =========================
  const bodyConnections = [
    [11,12],
    [11,13],[13,15],
    [12,14],[14,16],
    [11,23],[12,24],
    [23,24],
    [23,25],[25,27],
    [24,26],[26,28],
    [28,32],[27,31],
    [28,30],[30,32],
    [27,29],[29,31],
    [15,17],[17,19],[19,15],
    [16,18],[18,20],[20,16]
  ];

  bodyConnections.forEach(([a,b]) => {
    drawBone(poseLandmarks[a], poseLandmarks[b], 6);
  });

  poseLandmarks.forEach(p => drawJoint(p, 3));

  // =========================
  // HAND LOCKING
  // =========================
  if (handLandmarksList) {

    handLandmarksList.forEach(hand => {

      const handWrist = hand[0];

      // Find closest body wrist
      const leftWrist = poseLandmarks[15];
      const rightWrist = poseLandmarks[16];

      const distLeft = Math.abs(handWrist.x - leftWrist.x);
      const distRight = Math.abs(handWrist.x - rightWrist.x);

      const anchor = distLeft < distRight ? leftWrist : rightWrist;

      const offsetX = anchor.x - handWrist.x;
      const offsetY = anchor.y - handWrist.y;

      const adjustedHand = hand.map(p => ({
        x: p.x + offsetX,
        y: p.y + offsetY,
        z: p.z
      }));

      const handConnections = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20]
      ];

      handConnections.forEach(([a,b]) => {
        drawBone(adjustedHand[a], adjustedHand[b], 3);
      });

      adjustedHand.forEach(p => drawJoint(p, 2));
    });
  }
}