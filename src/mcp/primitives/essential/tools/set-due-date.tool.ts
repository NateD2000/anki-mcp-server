import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Matches the due-date formats AnkiConnect's setDueDate accepts:
 * "0" (today), "1" (tomorrow), "3-7" (random day 3-7 days from now),
 * with an optional "!" suffix to also reset the interval.
 */
const DAYS_FORMAT_REGEX = /^\d+(-\d+)?!?$/;

/**
 * Tool for rescheduling cards to a specific due date
 */
@McpController()
export class SetDueDateTool {
  private readonly logger = new Logger(SetDueDateTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "setDueDate",
    description:
      "Set the due date of cards, turning new cards into review cards if needed. " +
      'The days parameter accepts "0" (due today), "1" (due tomorrow), or a range ' +
      'like "3-7" (due a random number of days from now within the range).',
    parameters: z.object({
      cards: z
        .array(z.number())
        .min(1)
        .max(500)
        .describe(
          "Array of card IDs to reschedule (max 500 at once). Get these IDs from findCards, get_cards, or notesInfo.",
        ),
      days: z
        .string()
        .regex(
          DAYS_FORMAT_REGEX,
          'days must be a number ("0", "1") or a range ("3-7"), optionally suffixed with "!"',
        )
        .describe(
          'When the cards should be due: "0" = today, "1" = tomorrow, "3-7" = random day 3-7 days from now',
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      rescheduled: z.boolean(),
      cardCount: z.number(),
      days: z.string(),
      requestedIds: z.array(z.number()),
      message: z.string(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Set Due Date",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async setDueDate(
    @Payload() { cards, days }: { cards: number[]; days: string },
  ) {
    try {
      this.logger.log(
        `Setting due date of ${cards.length} card(s) to "${days}"`,
      );

      const result = await this.ankiClient.invoke<boolean>("setDueDate", {
        cards,
        days,
      });

      this.logger.log(`setDueDate result: ${result}`);

      return {
        success: true,
        rescheduled: result === true,
        cardCount: cards.length,
        days,
        requestedIds: cards,
        message:
          result === true
            ? `Successfully set due date of ${cards.length} card(s) to "${days}" day(s) from now`
            : `Cards were not rescheduled (the IDs may be invalid)`,
        hint: "New cards become review cards when given a due date. Use getCardReviews or get_cards to verify.",
      };
    } catch (error) {
      this.logger.error("Failed to set due date", error);

      return createErrorResponse(error, {
        requestedIds: cards,
        days,
        hint: "Make sure Anki is running and the card IDs are valid",
      });
    }
  }
}
