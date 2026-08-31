import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { AnkiCard } from "@/mcp/types/anki.types";
import { deckScopeQuery } from "@/mcp/utils/card-states.utils";
import {
  cleanHtml,
  createErrorResponse,
  getCardType,
} from "@/mcp/utils/anki.utils";

/**
 * Maximum number of leech cards to fetch detailed info for.
 */
const MAX_LEECH_RESULTS = 200;

/**
 * Tool for finding leech cards (cards that keep being forgotten)
 */
@McpController()
export class FindLeechesTool {
  private readonly logger = new Logger(FindLeechesTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "findLeeches",
    description:
      "Find leech cards - cards that are repeatedly forgotten (tagged 'leech' by Anki " +
      "or with a high lapse count). These cards waste study time and usually need " +
      "rewriting, splitting, or suspending.",
    parameters: z.object({
      deck: z
        .string()
        .optional()
        .describe(
          "Restrict the search to a specific deck (and its subdecks). If omitted, searches the whole collection.",
        ),
      minLapses: z
        .number()
        .int()
        .min(1)
        .default(6)
        .describe(
          "Minimum lapse count for a card to be considered a leech (default 6, half of Anki's default leech threshold of 8)",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      leeches: z.array(
        z.object({
          cardId: z.number(),
          noteId: z.number(),
          deckName: z.string(),
          question: z.string(),
          lapses: z.number(),
          cardType: z.string(),
          suspended: z.boolean(),
        }),
      ),
      total: z.number(),
      returned: z.number(),
      query: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    }),
    annotations: {
      title: "Find Leeches",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async findLeeches(
    @Payload()
    { deck, minLapses = 6 }: { deck?: string; minLapses?: number },
  ) {
    // Build an Anki search query matching cards Anki tagged as leeches OR
    // cards with a high lapse count (covers cards below the leech threshold).
    let query = `("tag:leech" OR "prop:lapses>=${minLapses}")`;
    if (deck) {
      // deckScopeQuery escapes `"`, `*`, `_` and `\` so the deck name is
      // treated literally, not as a search pattern.
      query = `${deckScopeQuery(deck)} ${query}`;
    }

    try {
      this.logger.log(`Finding leeches with query: ${query}`);

      const cardIds = await this.ankiClient.invoke<number[]>("findCards", {
        query,
      });

      if (cardIds.length === 0) {
        this.logger.log("No leech cards found");
        return {
          success: true,
          leeches: [],
          total: 0,
          returned: 0,
          query,
          message: "No leech cards found - your collection is in good shape!",
        };
      }

      // Cap detailed lookup for performance
      const selectedCardIds = cardIds.slice(0, MAX_LEECH_RESULTS);

      const cardsInfo = await this.ankiClient.invoke<AnkiCard[]>("cardsInfo", {
        cards: selectedCardIds,
      });

      const leeches = cardsInfo
        .map((card) => ({
          cardId: card.cardId,
          noteId: card.note,
          deckName: card.deckName,
          question: cleanHtml(card.question || ""),
          lapses: card.lapses || 0,
          cardType: getCardType(card.type),
          suspended: card.queue === -1,
        }))
        .sort((a, b) => b.lapses - a.lapses);

      this.logger.log(
        `Found ${cardIds.length} leech card(s), returning ${leeches.length}`,
      );

      return {
        success: true,
        leeches,
        total: cardIds.length,
        returned: leeches.length,
        query,
        message: `Found ${cardIds.length} leech card(s), returning ${leeches.length} sorted by lapse count`,
        hint: "Consider rewriting or splitting these cards, or use suspendCards to remove them from the review queue",
      };
    } catch (error) {
      this.logger.error("Failed to find leeches", error);

      return createErrorResponse(error, {
        query,
        hint: "Make sure Anki is running. If a deck was specified, verify its name with listDecks.",
      });
    }
  }
}
