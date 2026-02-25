function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSignedDeg(value) {
  const v = Math.round(value * 10) / 10;
  return `${v >= 0 ? "+" : ""}${v}°`;
}

function getYawDescription(yaw) {
  const absYaw = Math.abs(yaw);
  const side = yaw >= 0 ? "right" : "left";

  if (absYaw <= 15) {
    return "front-facing";
  }
  if (absYaw <= 45) {
    return `slight three-quarter view toward the ${side}`;
  }
  if (absYaw <= 90) {
    return `strong side angle toward the ${side}`;
  }
  if (absYaw > 120) {
    return "rear perspective";
  }
  return `oblique rear-side transition toward the ${side}`;
}

function getPitchDescription(pitch) {
  if (pitch > 0) return "low-angle shot";
  if (pitch < 0) return "high-angle shot";
  return "eye-level";
}

function getRollDescription(roll) {
  if (Math.abs(roll) < 1) return "";
  const side = roll > 0 ? "to the right" : "to the left";
  return `with a slight camera tilt ${side}`;
}

function getDistanceDescription(distance) {
  if (distance <= 0.3) return "close-up shot";
  if (distance <= 0.7) return "medium shot";
  return "wide shot";
}

function getLensDescription(fov) {
  if (fov < 0.3) return "standard lens";
  if (fov <= 0.7) return "slight wide-angle lens";
  return "strong wide-angle lens with perspective distortion";
}

export function generateMultiAnglePrompt(config = {}) {
  const yaw = clamp(toFiniteNumber(config.yaw, 0), -180, 180);
  const pitch = clamp(toFiniteNumber(config.pitch, 0), -60, 60);
  const roll = clamp(toFiniteNumber(config.roll, 0), -45, 45);
  const distance = clamp(toFiniteNumber(config.distance, 0.5), 0, 1);
  const fov = clamp(toFiniteNumber(config.fov, 0.2), 0, 1);

  const yawDesc = getYawDescription(yaw);
  const pitchDesc = getPitchDescription(pitch);
  const rollDesc = getRollDescription(roll);
  const distanceDesc = getDistanceDescription(distance);
  const lensDesc = getLensDescription(fov);

  const identityLock =
    "Keep the same subject, the same clothing, the same environment, the same lighting, the same body proportions, and the same visual identity with no redesign and no style change.";

  const cameraPose =
    `Set the camera to a ${yawDesc} at ${pitchDesc}${rollDesc ? " " + rollDesc : ""}. ` +
    `Use physically coherent pose parameters with yaw ${formatSignedDeg(yaw)}, pitch ${formatSignedDeg(pitch)}, and roll ${formatSignedDeg(roll)}.`;

  const spatialReconstruction =
    "Reconstruct scene geometry consistently, maintain accurate 3D structure, preserve spatial relationships, and enforce physically plausible camera movement across the frame.";

  const lensAndFraming =
    `Frame the subject as a ${distanceDesc} using a ${lensDesc}, while preserving depth continuity and realistic perspective scaling.`;

  const hardConstraints =
    "Do not change the subject identity. Only adjust the camera viewpoint. Maintain realistic 3D spatial consistency. No redesign or style alteration.";

  return (
    `${identityLock}\n\n` +
    `${cameraPose}\n\n` +
    `${spatialReconstruction}\n\n` +
    `${lensAndFraming}\n\n` +
    `${hardConstraints}`
  );
}

export default generateMultiAnglePrompt;
