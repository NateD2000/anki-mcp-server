import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Default directory for backup files.
 */
export const DEFAULT_BACKUP_DIR = path.join(
  os.homedir(),
  ".ankimcp",
  "backups",
);

/**
 * Sanitize a deck name into a safe filename fragment: replaces path
 * separators, Windows-forbidden characters, and whitespace runs.
 */
function sanitizeDeckFilename(deckName: string): string {
  return (
    deckName
      .replace(/::/g, "_")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "-")
      .replace(/_{2,}/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || "deck"
  );
}

/**
 * Build a YYYYMMDD-HHmmss timestamp for backup filenames.
 */
function buildTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Tool for backing up decks to .apkg files via AnkiConnect's exportPackage.
 *
 * AnkiConnect's exportPackage action exports a single deck (with scheduling
 * data when includeSched is true) to a path on the machine running Anki.
 * There is no single-call "export everything" variant, so when no deck is
 * given this tool exports each top-level deck to its own .apkg file.
 */
@McpController()
export class BackupCollectionTool {
  private readonly logger = new Logger(BackupCollectionTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "backupCollection",
    description:
      "Back up decks to .apkg files (including scheduling data) in ~/.ankimcp/backups/ " +
      "on the machine running Anki. Pass a deck name to back up one deck (and its " +
      "subdecks), or omit it to back up every top-level deck to a separate file. " +
      "Strongly recommended before destructive operations like deleteNotes or forgetCards. " +
      "Media-heavy decks can take several minutes to export, and Anki does not answer other " +
      "AnkiConnect requests until the export finishes — run this once and wait; never re-issue " +
      "the call while one is in flight (each retry queues another full export inside Anki).",
    parameters: z.object({
      deck: z
        .string()
        .optional()
        .describe(
          "Deck to back up (subdecks are included). If omitted, every top-level deck is exported to its own file.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      backups: z.array(
        z.object({
          deck: z.string(),
          path: z.string(),
          exported: z.boolean(),
        }),
      ),
      backupDir: z.string(),
      exportedCount: z.number(),
      failedCount: z.number(),
      message: z.string(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Backup Collection",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async backupCollection(@Payload() { deck }: { deck?: string }) {
    try {
      // Resolve which decks to export
      let decksToExport: string[];
      if (deck) {
        decksToExport = [deck];
      } else {
        const deckNames = await this.ankiClient.invoke<string[]>("deckNames");
        // Top-level decks only - exporting a parent includes its subdecks
        decksToExport = (deckNames || []).filter(
          (name) => !name.includes("::"),
        );

        if (decksToExport.length === 0) {
          return createErrorResponse(new Error("No decks found to back up"), {
            hint: "Make sure Anki is running and the collection has at least one deck",
          });
        }
      }

      // Ensure the backup directory exists
      fs.mkdirSync(DEFAULT_BACKUP_DIR, { recursive: true });

      const timestamp = buildTimestamp(new Date());
      const backups: Array<{ deck: string; path: string; exported: boolean }> =
        [];

      this.logger.log(
        `Backing up ${decksToExport.length} deck(s) to ${DEFAULT_BACKUP_DIR}`,
      );

      for (const deckName of decksToExport) {
        const filename = `${sanitizeDeckFilename(deckName)}-${timestamp}.apkg`;
        const filePath = path.join(DEFAULT_BACKUP_DIR, filename);

        const exported = await this.ankiClient.invoke<boolean>(
          "exportPackage",
          {
            deck: deckName,
            path: filePath,
            includeSched: true,
          },
          // exportPackage rewrites the whole deck (plus media) to disk and
          // can far outlive the default AnkiConnect timeout on large decks.
          { timeoutMs: 600_000 },
        );

        backups.push({
          deck: deckName,
          path: filePath,
          exported: exported === true,
        });

        this.logger.log(
          `Export of deck "${deckName}" to ${filePath}: ${exported === true ? "ok" : "FAILED"}`,
        );
      }

      const exportedCount = backups.filter((b) => b.exported).length;
      const failedCount = backups.length - exportedCount;

      return {
        success: failedCount === 0,
        backups,
        backupDir: DEFAULT_BACKUP_DIR,
        exportedCount,
        failedCount,
        message:
          failedCount === 0
            ? `Successfully backed up ${exportedCount} deck(s) to ${DEFAULT_BACKUP_DIR}`
            : `Backed up ${exportedCount} deck(s); ${failedCount} export(s) failed (check the deck names)`,
        hint: "Backups include scheduling data (includeSched: true) and can be restored via File > Import in Anki",
      };
    } catch (error) {
      this.logger.error("Failed to back up collection", error);

      return createErrorResponse(error, {
        deck,
        backupDir: DEFAULT_BACKUP_DIR,
        hint: "Make sure Anki is running. Note: files are written by Anki, so the path must be writable on the machine running Anki.",
      });
    }
  }
}
