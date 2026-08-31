import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Tool for deleting notes and their associated cards
 */
@McpController()
export class DeleteNotesTool {
  private readonly logger = new Logger(DeleteNotesTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "deleteNotes",
    description:
      "Delete notes by their IDs. This will permanently remove the notes and ALL associated cards. " +
      "This action cannot be undone unless you have a backup. CRITICAL: This is destructive and permanent - only delete notes the user explicitly confirmed for deletion. " +
      "By default this runs as a dry run (dryRun: true) that only previews what would be deleted; set dryRun: false to actually delete.",
    parameters: z.object({
      notes: z
        .array(z.number())
        .min(1)
        .max(100)
        .describe(
          "Array of note IDs to delete (max 100 at once for safety). " +
            "Get these IDs from findNotes tool. ALL cards associated with these notes will be deleted.",
        ),
      confirmDeletion: z
        .boolean()
        .describe(
          "Must be set to true to confirm you want to permanently delete these notes and their cards",
        ),
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "When true (the default), no notes are deleted - the tool returns a preview of what WOULD be deleted. " +
            "Set to false to actually perform the deletion.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      dryRun: z.boolean().optional(),
      wouldDeleteCount: z.number().optional(),
      wouldDeleteNoteIds: z.array(z.number()).optional(),
      cardsAffected: z.number().optional(),
      deletedCount: z.number().optional(),
      deletedNoteIds: z.array(z.number()).optional(),
      cardsDeleted: z.number().optional(),
      notFoundCount: z.number(),
      requestedIds: z.array(z.number()),
      message: z.string(),
      warning: z.string().optional(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Delete Notes",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  })
  async deleteNotes(
    @Payload()
    {
      notes,
      confirmDeletion,
      dryRun = true,
    }: {
      notes: number[];
      confirmDeletion: boolean;
      dryRun?: boolean;
    },
  ) {
    try {
      // Safety check - require explicit confirmation (dry runs are read-only
      // previews, so they don't need confirmation)
      if (!dryRun && !confirmDeletion) {
        return createErrorResponse(new Error("Deletion not confirmed"), {
          requestedNotes: notes,
          noteCount: notes.length,
          hint: "Set confirmDeletion to true to permanently delete these notes and all their cards",
          warning: "This action cannot be undone!",
        });
      }

      this.logger.log(
        `${dryRun ? "Dry run: previewing deletion of" : "Deleting"} ${notes.length} note(s)`,
      );

      // First, get info about the notes to be deleted (for logging and confirmation)
      const notesInfo = await this.ankiClient.invoke<any[]>("notesInfo", {
        notes: notes,
      });

      const validNotes = notesInfo.filter((note) => note && note.noteId);
      const validNoteIds = validNotes.map((note) => note.noteId);
      const notFoundCount = notes.length - validNotes.length;

      if (validNoteIds.length === 0) {
        this.logger.warn("No valid notes found to delete");

        return {
          success: true,
          deletedCount: 0,
          notFoundCount: notes.length,
          requestedIds: notes,
          message:
            "No notes were deleted (none of the provided IDs were valid)",
          hint: "The notes may have already been deleted or the IDs are invalid",
        };
      }

      // Count total cards that will be deleted
      const totalCards = validNotes.reduce(
        (sum, note) => sum + (note.cards?.length || 0),
        0,
      );

      // Dry run: return a preview without making any mutating call
      if (dryRun) {
        this.logger.log(
          `Dry run: would delete ${validNoteIds.length} note(s) and ${totalCards} card(s)`,
        );

        return {
          success: true,
          dryRun: true,
          wouldDeleteCount: validNoteIds.length,
          wouldDeleteNoteIds: validNoteIds,
          cardsAffected: totalCards,
          notFoundCount,
          requestedIds: notes,
          message: `Dry run: ${validNoteIds.length} note(s) and ${totalCards} card(s) WOULD be deleted. Nothing was deleted.`,
          hint: "Re-call with dryRun: false and confirmDeletion: true to actually delete these notes",
        };
      }

      // Call AnkiConnect deleteNotes action
      await this.ankiClient.invoke<null>("deleteNotes", {
        notes: validNoteIds,
      });

      this.logger.log(
        `Successfully deleted ${validNoteIds.length} note(s) and ${totalCards} card(s)`,
      );

      const message =
        notFoundCount > 0
          ? `Successfully deleted ${validNoteIds.length} note(s) and ${totalCards} card(s). ${notFoundCount} note(s) were not found.`
          : `Successfully deleted ${validNoteIds.length} note(s) and ${totalCards} card(s)`;

      return {
        success: true,
        deletedCount: validNoteIds.length,
        deletedNoteIds: validNoteIds,
        cardsDeleted: totalCards,
        notFoundCount,
        requestedIds: notes,
        message: message,
        warning: "These notes and cards have been permanently deleted",
        hint: "Consider syncing with AnkiWeb to propagate deletions to other devices",
      };
    } catch (error) {
      this.logger.error("Failed to delete notes", error);

      if (error instanceof Error) {
        if (error.message.includes("permission")) {
          return createErrorResponse(error, {
            requestedNotes: notes,
            hint: "Permission denied. Check if Anki allows deletions via AnkiConnect.",
          });
        }
      }

      return createErrorResponse(error, {
        requestedNotes: notes,
        hint: "Make sure Anki is running and the note IDs are valid",
      });
    }
  }
}
