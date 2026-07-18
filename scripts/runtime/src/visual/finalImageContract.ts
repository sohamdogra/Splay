export const FINAL_IMAGE_WIDTH = 1200;
export const FINAL_IMAGE_HEIGHT = 675;
export const FINAL_IMAGE_ASPECT_RATIO = FINAL_IMAGE_WIDTH / FINAL_IMAGE_HEIGHT;
const FINAL_IMAGE_ASPECT_TOLERANCE = 0.02;

export type FinalImageContract = {
  ok: boolean;
  dimensionsOk: boolean;
  aspectRatioOk: boolean;
  stylePromptOk: boolean;
  aspectRatio: number;
};

export function evaluateFinalImageContract(
  dimensions: { width: number; height: number },
  prompt: string
): FinalImageContract {
  const dimensionsOk = dimensions.width === FINAL_IMAGE_WIDTH && dimensions.height === FINAL_IMAGE_HEIGHT;
  const aspectRatio = dimensions.height > 0 ? dimensions.width / dimensions.height : 0;
  const aspectRatioOk = Math.abs(aspectRatio - FINAL_IMAGE_ASPECT_RATIO) <= FINAL_IMAGE_ASPECT_TOLERANCE;
  const stylePromptOk = hasDarkBlueWaveDirection(prompt);
  return {
    ok: dimensionsOk && aspectRatioOk && stylePromptOk,
    dimensionsOk,
    aspectRatioOk,
    stylePromptOk,
    aspectRatio
  };
}

export function hasDarkBlueWaveDirection(prompt: string): boolean {
  const darkBlue = /\b(?:dark|deep|midnight|navy|ink)\b[^.\n]{0,48}\bblue\b|\bblue\b[^.\n]{0,48}\b(?:dark|deep|midnight|navy|ink)\b/i.test(prompt);
  const wave = /\b(?:wave|waves|wavy|flow|flowing|curve|curved|contour|contours)\b/i.test(prompt);
  return darkBlue && wave;
}
