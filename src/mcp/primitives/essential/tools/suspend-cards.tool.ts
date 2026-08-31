import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Tool for suspending and unsuspending cards
 */
@McpController()
export class SuspendCardsTool {
  private readonly logger = new Logger(SuspendCardsTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "suspendCards",
    description:
      "Suspend cards by their IDs. Suspended cards are excluded from review until unsuspended. " +
      "This does not delete anything and is fully reversible with unsuspendCards.",
    parameters: z.object({
      cards: z
        .array(z.number())
        .min(1)
        .max(500)
        .describe(
          "Array of card IDs to suspend (max 500 at once). Get these IDs from findCards, get_cards, or notesInfo.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      suspended: z.boolean(),
      cardCount: z.number(),
      requestedIds: z.array(z.number()),
      message: z.string(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Suspend Cards",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async suspendCards(@Payload() { cards }: { cards: number[] }) {
    try {
      this.logger.log(`Suspending ${cards.length} card(s)`);

      const result = await this.ankiClient.invoke<boolean>("suspend", {
        cards,
      });

      this.logger.log(`Suspend result: ${result}`);

      return {
        success: true,
        suspended: result === true,
        cardCount: cards.length,
        requestedIds: cards,
        message:
          result === true
            ? `Successfully suspended ${cards.length} card(s)`
            : `No cards were suspended (they may already be suspended or the IDs are invalid)`,
        hint: "Use unsuspendCards to return these cards to the review queue",
      };
    } catch (error) {
      this.logger.error("Failed to suspend cards", error);

      return createErrorResponse(error, {
        requestedIds: cards,
        hint: "Make sure Anki is running and the card IDs are valid",
      });
    }
  }

  @Tool({
    name: "unsuspendCards",
    description:
      "Unsuspend cards by their IDs, returning them to the review queue. " +
      "Reverses a previous suspendCards call.",
    parameters: z.object({
      cards: z
        .array(z.number())
        .min(1)
        .max(500)
        .describe(
          "Array of card IDs to unsuspend (max 500 at once). Get these IDs from findCards, get_cards, or notesInfo.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      unsuspended: z.boolean(),
      cardCount: z.number(),
      requestedIds: z.array(z.number()),
      message: z.string(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Unsuspend Cards",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async unsuspendCards(@Payload() { cards }: { cards: number[] }) {
    try {
      this.logger.log(`Unsuspending ${cards.length} card(s)`);

      const result = await this.ankiClient.invoke<boolean>("unsuspend", {
        cards,
      });

      this.logger.log(`Unsuspend result: ${result}`);

      return {
        success: true,
        unsuspended: result === true,
        cardCount: cards.length,
        requestedIds: cards,
        message:
          result === true
            ? `Successfully unsuspended ${cards.length} card(s)`
            : `No cards were unsuspended (they may not be suspended or the IDs are invalid)`,
        hint: "The cards are back in the review queue and will appear when due",
      };
    } catch (error) {
      this.logger.error("Failed to unsuspend cards", error);

      return createErrorResponse(error, {
        requestedIds: cards,
        hint: "Make sure Anki is running and the card IDs are valid",
      });
    }
  }
}
