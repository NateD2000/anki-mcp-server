import { Test, TestingModule } from "@nestjs/testing";
import { ForgetCardsTool } from "../forget-cards.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

describe("ForgetCardsTool", () => {
  let tool: ForgetCardsTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ForgetCardsTool, AnkiConnectClient],
    }).compile();

    tool = module.get<ForgetCardsTool>(ForgetCardsTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("forgetCards", () => {
    it("should require confirmation before resetting", async () => {
      // Arrange
      const cardIds = [1502298033754, 1502298033758];

      // Act
      const rawResult = await tool.forgetCards({
        cards: cardIds,
        confirmReset: false,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Reset not confirmed");
      expect(result.hint).toContain("Set confirmReset to true");
      expect(result.warning).toContain("Scheduling history");
    });

    it("should successfully reset cards with confirmation", async () => {
      // Arrange
      const cardIds = [1502298033754, 1502298033758];
      ankiClient.invoke.mockResolvedValueOnce(null);

      // Act
      const rawResult = await tool.forgetCards({
        cards: cardIds,
        confirmReset: true,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("forgetCards", {
        cards: cardIds,
      });
      expect(result.success).toBe(true);
      expect(result.resetCount).toBe(2);
      expect(result.requestedIds).toEqual(cardIds);
      expect(result.message).toContain(
        "Successfully reset 2 card(s) to the new state",
      );
      expect(result.warning).toContain("scheduling history");
    });

    it("should suggest syncing after reset", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(null);

      // Act
      const rawResult = await tool.forgetCards({
        cards: [123],
        confirmReset: true,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.hint).toContain("Consider syncing with AnkiWeb");
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.forgetCards({
        cards: [123],
        confirmReset: true,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("invalid card ids", "forgetCards"),
      );

      // Act
      const rawResult = await tool.forgetCards({
        cards: [123],
        confirmReset: true,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid card ids");
      expect(result.requestedIds).toEqual([123]);
    });
  });
});
