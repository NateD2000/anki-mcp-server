import { Test, TestingModule } from "@nestjs/testing";
import { SuspendCardsTool } from "../suspend-cards.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

describe("SuspendCardsTool", () => {
  let tool: SuspendCardsTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SuspendCardsTool, AnkiConnectClient],
    }).compile();

    tool = module.get<SuspendCardsTool>(SuspendCardsTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("suspendCards", () => {
    it("should successfully suspend cards", async () => {
      // Arrange
      const cardIds = [1502298033754, 1502298033758];
      ankiClient.invoke.mockResolvedValueOnce(true);

      // Act
      const rawResult = await tool.suspendCards({ cards: cardIds });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("suspend", {
        cards: cardIds,
      });
      expect(result.success).toBe(true);
      expect(result.suspended).toBe(true);
      expect(result.cardCount).toBe(2);
      expect(result.requestedIds).toEqual(cardIds);
      expect(result.message).toContain("Successfully suspended 2 card(s)");
      expect(result.hint).toContain("unsuspendCards");
    });

    it("should report when no cards were suspended", async () => {
      // Arrange
      const cardIds = [9999999999];
      ankiClient.invoke.mockResolvedValueOnce(false);

      // Act
      const rawResult = await tool.suspendCards({ cards: cardIds });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(true);
      expect(result.suspended).toBe(false);
      expect(result.message).toContain("No cards were suspended");
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.suspendCards({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("collection is not available", "suspend"),
      );

      // Act
      const rawResult = await tool.suspendCards({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("collection is not available");
      expect(result.requestedIds).toEqual([123]);
    });
  });

  describe("unsuspendCards", () => {
    it("should successfully unsuspend cards", async () => {
      // Arrange
      const cardIds = [1502298033754];
      ankiClient.invoke.mockResolvedValueOnce(true);

      // Act
      const rawResult = await tool.unsuspendCards({ cards: cardIds });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("unsuspend", {
        cards: cardIds,
      });
      expect(result.success).toBe(true);
      expect(result.unsuspended).toBe(true);
      expect(result.message).toContain("Successfully unsuspended 1 card(s)");
    });

    it("should report when no cards were unsuspended", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(false);

      // Act
      const rawResult = await tool.unsuspendCards({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(true);
      expect(result.unsuspended).toBe(false);
      expect(result.message).toContain("No cards were unsuspended");
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.unsuspendCards({ cards: [123] });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });
  });
});
