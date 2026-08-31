import { Test, TestingModule } from "@nestjs/testing";
import { FindLeechesTool } from "../find-leeches.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

const leechCard = (overrides: Record<string, any> = {}) => ({
  cardId: 1502298033754,
  note: 1502298033753,
  deckName: "Spanish",
  question: "<b>¿Cómo estás?</b>",
  answer: "¿Cómo estás?\n\n<hr id=answer>\n\nHow are you?",
  lapses: 8,
  type: 2,
  queue: 2,
  modelName: "Basic",
  fieldOrder: 0,
  ord: 0,
  css: "",
  fields: {},
  ...overrides,
});

describe("FindLeechesTool", () => {
  let tool: FindLeechesTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FindLeechesTool, AnkiConnectClient],
    }).compile();

    tool = module.get<FindLeechesTool>(FindLeechesTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("findLeeches", () => {
    it("should find leeches with the default lapse threshold", async () => {
      // Arrange
      ankiClient.invoke
        .mockResolvedValueOnce([1502298033754]) // findCards
        .mockResolvedValueOnce([leechCard()]); // cardsInfo

      // Act
      const rawResult = await tool.findLeeches({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenNthCalledWith(1, "findCards", {
        query: '("tag:leech" OR "prop:lapses>=6")',
      });
      expect(ankiClient.invoke).toHaveBeenNthCalledWith(2, "cardsInfo", {
        cards: [1502298033754],
      });
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.returned).toBe(1);
      expect(result.leeches[0]).toEqual({
        cardId: 1502298033754,
        noteId: 1502298033753,
        deckName: "Spanish",
        question: "¿Cómo estás?", // HTML stripped
        lapses: 8,
        cardType: "review",
        suspended: false,
      });
    });

    it("should scope the query to a deck when provided", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce([]);

      // Act
      const rawResult = await tool.findLeeches({
        deck: "Spanish",
        minLapses: 4,
      });
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenCalledWith("findCards", {
        query: '"deck:Spanish" ("tag:leech" OR "prop:lapses>=4")',
      });
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.message).toContain("No leech cards found");
    });

    it("should sort leeches by lapse count descending", async () => {
      // Arrange
      ankiClient.invoke
        .mockResolvedValueOnce([1, 2])
        .mockResolvedValueOnce([
          leechCard({ cardId: 1, lapses: 3 }),
          leechCard({ cardId: 2, lapses: 12 }),
        ]);

      // Act
      const rawResult = await tool.findLeeches({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.leeches.map((l: any) => l.cardId)).toEqual([2, 1]);
    });

    it("should mark suspended leeches", async () => {
      // Arrange
      ankiClient.invoke
        .mockResolvedValueOnce([1])
        .mockResolvedValueOnce([leechCard({ cardId: 1, queue: -1 })]);

      // Act
      const rawResult = await tool.findLeeches({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.leeches[0].suspended).toBe(true);
    });

    it("should cap detailed lookup at 200 cards", async () => {
      // Arrange
      const manyCardIds = Array.from({ length: 250 }, (_, i) => i + 1);
      ankiClient.invoke
        .mockResolvedValueOnce(manyCardIds)
        .mockResolvedValueOnce(
          manyCardIds.slice(0, 200).map((id) => leechCard({ cardId: id })),
        );

      // Act
      const rawResult = await tool.findLeeches({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenNthCalledWith(2, "cardsInfo", {
        cards: manyCardIds.slice(0, 200),
      });
      expect(result.total).toBe(250);
      expect(result.returned).toBe(200);
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.findLeeches({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("invalid search", "findCards"),
      );

      // Act
      const rawResult = await tool.findLeeches({ deck: "Missing" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid search");
      expect(result.query).toContain('"deck:Missing"');
    });
  });
});
