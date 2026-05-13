import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBountyLabels,
  parseBountyLabel,
} from "../src/lib/github/bounty-label.ts";
import { extractLinkedIssueNumbers } from "../src/lib/github/linked-issues.ts";
import {
  inviteRequiredMessage,
  invoiceCreatedMessage,
} from "../src/lib/github/messages.ts";

describe("parseBountyLabel", () => {
  it("parses explicit currency labels", () => {
    assert.deepEqual(parseBountyLabel("pvium:20USDC"), {
      amount: 20,
      currency: "USDC",
      raw: "pvium:20USDC",
    });
  });

  it("defaults currency to USDC", () => {
    assert.deepEqual(parseBountyLabel("pvium:10"), {
      amount: 10,
      currency: "USDC",
      raw: "pvium:10",
    });
  });

  it("parses decimal amounts and normalizes currency", () => {
    assert.deepEqual(parseBountyLabel("pvium:12.5usdt"), {
      amount: 12.5,
      currency: "USDT",
      raw: "pvium:12.5usdt",
    });
  });

  it("parses labels with a space before the currency", () => {
    assert.deepEqual(parseBountyLabel("pvium:20 USDC"), {
      amount: 20,
      currency: "USDC",
      raw: "pvium:20 USDC",
    });
  });

  it("rejects non-Pvium labels", () => {
    assert.equal(parseBountyLabel("bug"), null);
    assert.equal(parseBountyLabel("pvium:"), null);
  });
});

describe("extractBountyLabels", () => {
  it("filters labels down to valid bounty labels", () => {
    assert.deepEqual(
      extractBountyLabels([
        { name: "bug" },
        { name: "pvium:5" },
        { name: "pvium:2eth" },
        {},
      ]),
      [
        { amount: 5, currency: "USDC", raw: "pvium:5" },
        { amount: 2, currency: "ETH", raw: "pvium:2eth" },
      ],
    );
  });
});

describe("extractLinkedIssueNumbers", () => {
  it("extracts unique closing issue references from title and body", () => {
    assert.deepEqual(
      extractLinkedIssueNumbers("Fixes #12", "Closes #8 and resolves #12"),
      [8, 12],
    );
  });

  it("ignores non-closing references", () => {
    assert.deepEqual(
      extractLinkedIssueNumbers("Refs #12", "Related to #8"),
      [],
    );
  });
});

describe("GitHub messages", () => {
  it("renders an invite link for contributors that need OAuth", () => {
    const body = inviteRequiredMessage({
      githubLogin: "octocat",
      inviteLink: "https://pvium.test/invite",
      amount: "20",
      currency: "USDC",
    });

    assert.match(body, /@octocat/);
    assert.match(body, /https:\/\/pvium\.test\/invite/);
  });

  it("renders a payable reward link for maintainers", () => {
    const body = invoiceCreatedMessage({
      githubLogin: "octocat",
      invoiceUrl: "https://pvium.test/invoice/123",
      amount: "20",
      currency: "USDC",
    });

    assert.match(
      body,
      /\[Pay reward\]\(https:\/\/pvium\.test\/invoice\/123\)/,
    );
  });
});
