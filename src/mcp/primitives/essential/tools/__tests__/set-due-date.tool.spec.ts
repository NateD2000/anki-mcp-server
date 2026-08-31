import { Test, TestingModule } from "@nestjs/testing";
import { SetDueDateTool } from "../set-due-date.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

describe("SetDueDateTool", () => {
  let tool: SetDueDateTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SetDueDateTool, AnkiConnectClient],
    }).compile();

    tool = module.get<SetDueDateTool>(SetDueDateTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("setDueDate", () => {
    it("should set due date to a specific day", async () => {
      // Arrange
      const cardIds = [1502298033754, 1502298033758];
      ankiClient.invoke.mockResolvedValueOnce(true);

      // Act
      const rawResult = await tool.setDueDate({ cards: cardIds, days: "0" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("setDueDate", {
        cards: cardIds,
        days: "0",
      });
      expect(result.success).toBe(true);
      expect(result.rescheduled).toBe(true);
      expect(result.cardCount).toBe(2);
      expect(result.days).toBe("0");
      expect(result.message).toContain("Successfully set due date");
    });

    it("should support day ranges", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(true);

      // Act
      const rawResult = await tool.setDueDate({ cards: [123], days: "3-7" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("setDueDate", {
        cards: [123],
        days: "3-7",
      });
      expect(result.success).toBe(true);
      expect(result.days).toBe("3-7");
    });

    it("should report when cards were not rescheduled", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(false);

      // Act
      const rawResult = await tool.setDueDate({
        cards: [9999999999],
        days: "1",
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(true);
      expect(result.rescheduled).toBe(false);
      expect(result.message).toContain("not rescheduled");
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.setDueDate({ cards: [123], days: "1" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("invalid days string", "setDueDate"),
      );

      // Act
      const rawResult = await tool.setDueDate({ cards: [123], days: "1" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid days string");
      expect(result.requestedIds).toEqual([123]);
      expect(result.days).toBe("1");
    });
  });
});
