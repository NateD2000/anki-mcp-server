import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Tool for resetting cards to the "new" state
 */
@McpController()
export class ForgetCardsTool {
  private readonly logger = new Logger(ForgetCardsTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "forgetCards",
    description:
      "Reset cards to the 'new' state, erasing their scheduling history. " +
      "The cards will be treated as never studied. This cannot be undone - " +
      "only reset cards the user explicitly confirmed for resetting.",
    parameters: z.object({
      cards: z
        .array(z.number())
        .min(1)
        .max(500)
        .describe(
          "Array of card IDs to reset to new (max 500 at once). Get these IDs from findCards, get_cards, or notesInfo.",
        ),
      confirmReset: z
        .boolean()
        .describe(
          "Must be set to true to confirm you want to reset these cards' scheduling history",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      resetCount: z.number(),
      requestedIds: z.array(z.number()),
      message: z.string(),
      warning: z.string().optional(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Forget Cards",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  })
  async forgetCards(
    @Payload()
    { cards, confirmReset }: { cards: number[]; confirmReset: boolean },
  ) {
    try {
      // Safety check - require explicit confirmation
      if (!confirmReset) {
        return createErrorResponse(new Error("Reset not confirmed"), {
          requestedIds: cards,
          cardCount: cards.length,
          hint: "Set confirmReset to true to reset these cards to the new state",
          warning: "Scheduling history for these cards will be lost!",
        });
      }

      this.logger.log(`Resetting ${cards.length} card(s) to new`);

      await this.ankiClient.invoke<null>("forgetCards", {
        cards,
      });

      this.logger.log(`Successfully reset ${cards.length} card(s) to new`);

      return {
        success: true,
        resetCount: cards.length,
        requestedIds: cards,
        message: `Successfully reset ${cards.length} card(s) to the new state`,
        warning: "The scheduling history of these cards has been erased",
        hint: "Consider syncing with AnkiWeb to propagate changes to other devices",
      };
    } catch (error) {
      this.logger.error("Failed to reset cards", error);

      return createErrorResponse(error, {
        requestedIds: cards,
        hint: "Make sure Anki is running and the card IDs are valid",
      });
    }
  }
}
