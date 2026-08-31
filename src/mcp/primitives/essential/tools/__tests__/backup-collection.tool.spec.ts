import * as fs from "node:fs";
import * as path from "node:path";
import { Test, TestingModule } from "@nestjs/testing";
import {
  BackupCollectionTool,
  DEFAULT_BACKUP_DIR,
} from "../backup-collection.tool";
import {
  AnkiConnectClient,
  AnkiConnectError,
} from "../../../../clients/anki-connect.client";
import { parseToolResult } from "../../../../../test-fixtures/test-helpers";

jest.mock("../../../../clients/anki-connect.client");

// Avoid touching the real filesystem in unit tests
jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");
  return {
    ...actual,
    mkdirSync: jest.fn(),
  };
});

const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;

describe("BackupCollectionTool", () => {
  let tool: BackupCollectionTool;
  let ankiClient: jest.Mocked<AnkiConnectClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BackupCollectionTool, AnkiConnectClient],
    }).compile();

    tool = module.get<BackupCollectionTool>(BackupCollectionTool);
    ankiClient = module.get(
      AnkiConnectClient,
    ) as jest.Mocked<AnkiConnectClient>;

    jest.clearAllMocks();
  });

  describe("backupCollection", () => {
    it("should back up a single named deck", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(true); // exportPackage

      // Act
      const rawResult = await tool.backupCollection({ deck: "Spanish" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(mockMkdirSync).toHaveBeenCalledWith(DEFAULT_BACKUP_DIR, {
        recursive: true,
      });
      expect(ankiClient.invoke).toHaveBeenCalledTimes(1);
      expect(ankiClient.invoke).toHaveBeenCalledWith(
        "exportPackage",
        expect.objectContaining({
          deck: "Spanish",
          includeSched: true,
          path: expect.stringMatching(/Spanish-\d{8}-\d{6}\.apkg$/),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.exportedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.backups).toHaveLength(1);
      expect(result.backups[0].deck).toBe("Spanish");
      expect(result.backups[0].exported).toBe(true);
      expect(result.backupDir).toBe(DEFAULT_BACKUP_DIR);
    });

    it("should back up every top-level deck when no deck is given", async () => {
      // Arrange
      ankiClient.invoke
        .mockResolvedValueOnce([
          "Default",
          "Spanish",
          "Japanese::JLPT N5", // subdeck - must be skipped
          "French",
        ]) // deckNames
        .mockResolvedValueOnce(true) // exportPackage Default
        .mockResolvedValueOnce(true) // exportPackage Spanish
        .mockResolvedValueOnce(true); // exportPackage French

      // Act
      const rawResult = await tool.backupCollection({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(ankiClient.invoke).toHaveBeenNthCalledWith(1, "deckNames");
      expect(ankiClient.invoke).toHaveBeenCalledTimes(4); // deckNames + 3 exports
      expect(result.success).toBe(true);
      expect(result.exportedCount).toBe(3);
      expect(result.backups.map((b: any) => b.deck)).toEqual([
        "Default",
        "Spanish",
        "French",
      ]);
    });

    it("should sanitize deck names in filenames", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce(true);

      // Act
      const rawResult = await tool.backupCollection({
        deck: 'My/Deck: "Test"?',
      });
      const result = parseToolResult(rawResult);

      // Assert
      const exportCall = ankiClient.invoke.mock.calls[0][1] as any;
      const filename = path.basename(exportCall.path);
      expect(filename).not.toMatch(/[\\/:*?"<>|]/);
      expect(filename).toMatch(/\.apkg$/);
      expect(exportCall.deck).toBe('My/Deck: "Test"?'); // original name sent to Anki
      expect(result.success).toBe(true);
    });

    it("should report failed exports without throwing", async () => {
      // Arrange
      ankiClient.invoke
        .mockResolvedValueOnce(["Default", "Ghost"]) // deckNames
        .mockResolvedValueOnce(true) // Default export ok
        .mockResolvedValueOnce(false); // Ghost export failed

      // Act
      const rawResult = await tool.backupCollection({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.exportedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.message).toContain("1 export(s) failed");
    });

    it("should error when the collection has no decks", async () => {
      // Arrange
      ankiClient.invoke.mockResolvedValueOnce([]);

      // Act
      const rawResult = await tool.backupCollection({});
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("No decks found");
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(new Error("fetch failed"));

      // Act
      const rawResult = await tool.backupCollection({ deck: "Spanish" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(result.hint).toContain("Make sure Anki is running");
    });

    it("should handle AnkiConnect errors", async () => {
      // Arrange
      ankiClient.invoke.mockRejectedValueOnce(
        new AnkiConnectError("deck was not found", "exportPackage"),
      );

      // Act
      const rawResult = await tool.backupCollection({ deck: "Missing" });
      const result = parseToolResult(rawResult);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("deck was not found");
      expect(result.deck).toBe("Missing");
    });
  });
});
