import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePlatformFeeAmount } from "../src/lib/pvium/fees.ts";

describe("calculatePlatformFeeAmount", () => {
  it("computes platform fees from basis points", () => {
    assert.equal(
      calculatePlatformFeeAmount({
        rewardAmount: 100,
        feeBasisPoints: 250,
        maxFeeAmount: 0,
        decimals: 6,
      }),
      2.5,
    );
  });

  it("caps platform fees when a max amount is configured", () => {
    assert.equal(
      calculatePlatformFeeAmount({
        rewardAmount: 1000,
        feeBasisPoints: 250,
        maxFeeAmount: 10,
        decimals: 6,
      }),
      10,
    );
  });

  it("rounds down to token decimals", () => {
    assert.equal(
      calculatePlatformFeeAmount({
        rewardAmount: 1,
        feeBasisPoints: 3333,
        maxFeeAmount: 0,
        decimals: 2,
      }),
      0.33,
    );
  });
});
