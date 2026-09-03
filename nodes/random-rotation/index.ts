export interface RandomRotationOptions {
  /** これ以上は必ず回転させる最小の周回数(デフォルト: 4) */
  minTurns?: number;
  /** これ以下に収める最大の周回数(デフォルト: 7) */
  maxTurns?: number;
}

/**
 * 現在の累積回転角(currentRotationDeg)を起点に、ランダムな周回数と
 * ランダムな最終角度を加えた「次の累積回転角」を1つ返す。
 *
 * 呼び出し側はこの値をそのままCSSのtransform: rotate()等に渡せる。
 * 最終的な停止角度(0-360度)が必要な場合は `result % 360` で求める。
 */
export function pickNextRotationDeg(
  currentRotationDeg: number,
  options: RandomRotationOptions = {},
): number {
  const { minTurns = 4, maxTurns = 7 } = options;
  if (minTurns <= 0 || maxTurns < minTurns) {
    throw new Error("minTurns/maxTurnsの指定が不正: 0 < minTurns <= maxTurns である必要がある");
  }

  const randomAngle = Math.random() * 360;
  const extraTurns = minTurns + Math.random() * (maxTurns - minTurns);
  return currentRotationDeg + extraTurns * 360 + randomAngle;
}
