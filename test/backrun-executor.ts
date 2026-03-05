import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { ethers } from "ethers";
import {
  calculateBackrunProfit,
  isProfitable,
} from "../scripts/gas-estimator.js";

import {
  isKnownMevBot,
  trackOpportunity,
  removeOpportunity,
  isOpportunityBeingPursued,
  cleanupExpiredOpportunities,
  estimateCompetitiveGasPrice,
} from "../scripts/sandwich-detector.js";

import {
  calculateAccurateProfit,
} from "../scripts/price-oracle.js";

describe("Gas Estimator Tests", () => {
  describe("calculateBackrunProfit", () => {
    it("should calculate profit correctly with positive impact", () => {
      const amountIn = ethers.parseEther("10");
      const impactPercent = 1.0;
      const gasCost = ethers.parseEther("0.01");

      const result = calculateBackrunProfit(amountIn, impactPercent, gasCost);

      expect(result.netProfit).to.be.greaterThan(0n);
      expect(result.profitable).to.equal(true);
    });

    it("should return negative profit when gas exceeds gains", () => {
      const amountIn = ethers.parseEther("1");
      const impactPercent = 0.1;
      const gasCost = ethers.parseEther("1");

      const result = calculateBackrunProfit(amountIn, impactPercent, gasCost);

      expect(result.netProfit).to.be.lessThan(0n);
      expect(result.profitable).to.equal(false);
    });

    it("should handle zero impact gracefully", () => {
      const amountIn = ethers.parseEther("10");
      const impactPercent = 0;
      const gasCost = ethers.parseEther("0.01");

      const result = calculateBackrunProfit(amountIn, impactPercent, gasCost);

      expect(result.netProfit).to.be.lessThan(0n);
    });
  });

  describe("isProfitable", () => {
    it("should return true for profitable scenario", () => {
      const amountIn = ethers.parseEther("10");
      const impactPercent = 1.0;
      const gasCost = ethers.parseEther("0.01");

      expect(isProfitable(amountIn, impactPercent, gasCost)).to.equal(true);
    });

    it("should return false for unprofitable scenario", () => {
      const amountIn = ethers.parseEther("1");
      const impactPercent = 0.1;
      const gasCost = ethers.parseEther("2");

      expect(isProfitable(amountIn, impactPercent, gasCost)).to.equal(false);
    });
  });
});

describe("Sandwich Detector Tests", () => {
  beforeEach(() => {
    cleanupExpiredOpportunities();
  });

  describe("isKnownMevBot", () => {
    it("should return false for unknown addresses", () => {
      expect(isKnownMevBot("0x0000000000000000000000000000000000000000")).to.equal(false);
    });
  });

  describe("trackOpportunity", () => {
    it("should track a new opportunity", () => {
      const txHash = "0x1234567890abcdef1234567890abcdef12345678";
      trackOpportunity(txHash);
      expect(isOpportunityBeingPursued(txHash)).to.equal(true);
    });

    it("should track duplicate opportunities without error", () => {
      const txHash = "0x1234567890abcdef1234567890abcdef12345678";
      trackOpportunity(txHash);
      trackOpportunity(txHash);
      expect(isOpportunityBeingPursued(txHash)).to.equal(true);
    });
  });

  describe("removeOpportunity", () => {
    it("should remove tracked opportunity", () => {
      const txHash = "0x1234567890abcdef1234567890abcdef12345678";
      trackOpportunity(txHash);
      expect(isOpportunityBeingPursued(txHash)).to.equal(true);
      removeOpportunity(txHash);
      expect(isOpportunityBeingPursued(txHash)).to.equal(false);
    });
  });

  describe("estimateCompetitiveGasPrice", () => {
    it("should increase gas price with competition", async () => {
      const baseGasPrice = ethers.parseUnits("50", "gwei");
      
      const noCompetition = await estimateCompetitiveGasPrice(
        {} as any,
        baseGasPrice,
        0
      );
      
      const someCompetition = await estimateCompetitiveGasPrice(
        {} as any,
        baseGasPrice,
        1
      );
      
      const highCompetition = await estimateCompetitiveGasPrice(
        {} as any,
        baseGasPrice,
        3
      );
      
      expect(someCompetition).to.be.greaterThan(noCompetition);
      expect(highCompetition).to.be.greaterThan(someCompetition);
    });

    it("should cap gas price at maximum", async () => {
      const baseGasPrice = ethers.parseUnits("1000", "gwei");
      
      const result = await estimateCompetitiveGasPrice(
        {} as any,
        baseGasPrice,
        10
      );
      
      const maxPrice = 500n * 1_000_000_000n;
      expect(result).to.be.lessThanOrEqual(maxPrice);
    });
  });
});

describe("Price Oracle Tests", () => {
  describe("calculateAccurateProfit", () => {
    it("should return unprofitable when oracle unavailable", async () => {
      const mockProvider = {
        call: () => { throw new Error("Oracle unavailable"); }
      };
      
      const result = await calculateAccurateProfit(
        mockProvider as any,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        ethers.parseEther("10"),
        ethers.parseEther("0.01")
      );
      
      expect(result.profitable).to.equal(false);
      expect(result.netProfit).to.be.lessThan(0n);
    });
  });
});

describe("Integration Tests", () => {
  it("should have all critical functions exported", () => {
    expect(calculateBackrunProfit).to.be.a("function");
    expect(isProfitable).to.be.a("function");
    expect(isKnownMevBot).to.be.a("function");
    expect(trackOpportunity).to.be.a("function");
    expect(removeOpportunity).to.be.a("function");
    expect(isOpportunityBeingPursued).to.be.a("function");
    expect(estimateCompetitiveGasPrice).to.be.a("function");
    expect(calculateAccurateProfit).to.be.a("function");
  });
});
