import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";

/**
 * Shape of a single review entry as returned by AnkiConnect's
 * getReviewsOfCards action.
 */
interface AnkiReviewEntry {
  id: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

/**
 * Tool for retrieving the review history of cards
 */
@McpController()
export class CardReviewsTool {
  private readonly logger = new Logger(CardReviewsTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "getCardReviews",
    description:
      "Get the review history for specific cards: per-review ease (button pressed), " +
      "interval, ease factor, time taken, and timestamp. Useful for analyzing " +
      "learning progress and identifying problem cards.",
    parameters: z.object({
      cards: z
        .array(z.number())
        .min(1)
        .max(100)
        .describe(
          "Array of card IDs to get review history for (max 100 at once). Get these IDs from findCards, get_cards, or notesInfo.",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      reviews: z.record(
        z.string(),
        z.array(
          z.object({
            reviewTime: z.number(),
            ease: z.number(),
            interval: z.number(),
            lastInterval: z.number(),
            factor: z.number(),
            timeTakenMs: z.number(),
            type: z.number(),
          }),
        ),
      ),
      cardCount: z.number(),
      totalReviews: z.number(),
      message: z.string(),
    }),
    annotations: {
      title: "Get Card Reviews",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async getCardReviews(@Payload() { cards }: { cards: number[] }) {
    try {
      this.logger.log(`Getting review history for ${cards.length} card(s)`);

      const rawReviews = await this.ankiClient.invoke<
        Record<string, AnkiReviewEntry[]>
      >("getReviewsOfCards", {
        cards,
      });

      // Transform raw column names (ivl, lastIvl, time) into readable ones
      const reviews: Record<
        string,
        Array<{
          reviewTime: number;
          ease: number;
          interval: number;
          lastInterval: number;
          factor: number;
          timeTakenMs: number;
          type: number;
        }>
      > = {};

      let totalReviews = 0;

      for (const [cardId, entries] of Object.entries(rawReviews || {})) {
        reviews[cardId] = (entries || []).map((entry) => ({
          reviewTime: entry.id,
          ease: entry.ease,
          interval: entry.ivl,
          lastInterval: entry.lastIvl,
          factor: entry.factor,
          timeTakenMs: entry.time,
          type: entry.type,
        }));
        totalReviews += reviews[cardId].length;
      }

      this.logger.log(
        `Retrieved ${totalReviews} review(s) across ${cards.length} card(s)`,
      );

      return {
        success: true,
        reviews,
        cardCount: cards.length,
        totalReviews,
        message: `Found ${totalReviews} review(s) across ${cards.length} card(s). Timestamps are epoch milliseconds; positive intervals are days, negative are seconds.`,
      };
    } catch (error) {
      this.logger.error("Failed to get card reviews", error);

      return createErrorResponse(error, {
        requestedIds: cards,
        hint: "Make sure Anki is running and the card IDs are valid. This action requires AnkiConnect API version 6+.",
      });
    }
  }
}
