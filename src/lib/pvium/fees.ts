export function calculatePlatformFeeAmount(params: {
  rewardAmount: number;
  feeBasisPoints: number;
  maxFeeAmount: number;
  decimals: number;
}) {
  if (params.rewardAmount <= 0 || params.feeBasisPoints <= 0) return 0;

  const uncappedFee = (params.rewardAmount * params.feeBasisPoints) / 10000;
  const cappedFee =
    params.maxFeeAmount > 0
      ? Math.min(uncappedFee, params.maxFeeAmount)
      : uncappedFee;
  const tokenUnits = 10 ** params.decimals;

  return Math.floor(cappedFee * tokenUnits) / tokenUnits;
}
