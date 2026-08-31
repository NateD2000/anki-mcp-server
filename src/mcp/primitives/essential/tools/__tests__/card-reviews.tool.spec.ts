import { Test, TestingModule } from "@nestjs/testing";
import { CardReviewsTool } from "../card-reviews.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

describe("CardReviewsTool", () => {
  let tool: CardReviewsTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CardReviewsTool, AnkiConnectClient],
    }).compile();

    tool = module.get<CardReviewsTool>(CardReviewsTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("getCardReviews", () => {
    it("should return transformed review history per card", async () => {
      // Arrange
      const cardIds = [1502298033754];
      const rawReviews = {
        "1502298033754": [
          {
            id: 1693923840000,
            usn: 1750,
            ease: 3,
            ivl: 10,
            lastIvl: 5,
            factor: 2500,
            time: 7500,
            type: 1,
          },
          {
            id: 1694523840000,
            usn: 1751,
            ease: 1,
            ivl: -60,
            lastIvl: 10,
            factor: 2350,
            time: 12000,
            type: 1,
          },
        ],
      };
      ankiClient.invoke.mockResolvedValueOnce(rawReviews);

      // Act
      const rawResult = await tool.getCardReviews({ cards: cardIds });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("getReviewsOfCards", {
        cards: cardIds,
      });
      expect(result.success).toBe(true);
      expect(result.cardCount).toBe(1);
      expect(result.totalReviews).toBe(2);
      expect(result.reviews["1502298033754"]).toHaveLength(2);
      expect(result.reviews["1502298033754"][0]).toEqual({
        reviewTime: 1693923840000,
        ease: 3,
        interval: 10,
        lastInterval: 5,
        factor: 2500,
        timeTakenMs: 7500,
        type: 1,
      });
    });

    it("should handle cards with no review history", async () => {
      // Arrange
      const cardIds = [1502298033758];
      ankiClient.invoke.mockResolvedValueOnce({ "1502298033758": [] });

      // Act
      const rawResult = await tool.getCardReviews({ cards: cardIds });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(true);
      expect(result.totalReviews).toBe(0);
      expect(result.reviews["1502298033758"]).toEqual([]);
    });

    it("should handle an empty response object", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce({});

      // Act
      const rawResult = await tool.getCardReviews({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(true);
      expect(result.totalReviews).toBe(0);
      expect(result.reviews).toEqual({});
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.getCardReviews({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("unsupported action", "getReviewsOfCards"),
      );

      // Act
      const rawResult = await tool.getCardReviews({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("unsupported action");
      expect(result.requestedIds).toEqual([123]);
    });
  });
});
