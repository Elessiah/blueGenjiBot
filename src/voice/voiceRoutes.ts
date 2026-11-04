/**
 * Routes `/internal/voice/*` de l'API interne (MATCH-VOICE) : création et
 * libération des salons vocaux d'équipe (aucune route de comptage). Montées par `startInternalApi`
 * derrière la même garde `x-internal-token` que les autres routes ; la logique
 * vit dans `voice/matchVoice.ts`.
 *
 * Une réponse d'erreur ne porte qu'un code (`{ error }`) ; le détail technique
 * part au journal, jamais un membre ni un pseudo.
 */

import type { Express, Request, Response } from "express";
import type { Client } from "discord.js";
import { sendLog } from "../safe/sendLog.js";
import {
  VoiceChannelError,
  ensureTeamVoiceChannel,
  parseChannelId,
  parseVoiceKey,
  releaseVoiceChannel,
  sanitizeVoiceChannelName,
} from "./matchVoice.js";

/**
 * Répond l'erreur d'une route vocale : le code d'une `VoiceChannelError`,
 * sinon `500 VOICE_INTERNAL_ERROR`. Le détail va au journal (`@silent`).
 * @param client Client Discord, pour le journal.
 * @param res Réponse.
 * @param route Route en cause.
 * @param error Erreur capturée.
 */
async function replyVoiceError(client: Client, res: Response, route: string, error: unknown): Promise<void> {
  if (error instanceof VoiceChannelError) {
    res.status(error.status).json({ error: error.code });
    if (error.status >= 500) {
      await sendLog(client, `${route} : ${error.code} (${error.message})`);
    }
    return;
  }
  res.status(500).json({ error: "VOICE_INTERNAL_ERROR" });
  await sendLog(client, `${route} error: ${(error as Error)?.message ?? String(error)}`);
}

/**
 * Refuse en `503 DISCORD_NOT_READY` tant que le client n'est pas connecté.
 * @param client Client Discord.
 * @param res Réponse, envoyée en cas de refus.
 * @returns `true` si la réponse est partie.
 */
function refuseNotReady(client: Client, res: Response): boolean {
  if (client.isReady()) { return false; }
  res.status(503).json({ error: "DISCORD_NOT_READY" });
  return true;
}

/**
 * Monte les routes vocales sur l'application Express de l'API interne.
 * @param app Application Express, garde `authorize` déjà posée sur `/internal`.
 * @param client Client Discord.
 */
export function registerVoiceRoutes(app: Express, client: Client): void {
  app.post("/internal/voice/channels", async (req: Request, res: Response) => {
    const key = parseVoiceKey(req.body?.key);
    if (!key) {
      res.status(400).json({ error: "INVALID_VOICE_KEY" });
      return;
    }
    const name = sanitizeVoiceChannelName(req.body?.name);
    if (!name) {
      res.status(400).json({ error: "INVALID_VOICE_CHANNEL_NAME" });
      return;
    }
    if (refuseNotReady(client, res)) { return; }
    try {
      const { channelId, created } = await ensureTeamVoiceChannel(client, key, name);
      res.status(created ? 201 : 200).json({ channelId });
    } catch (error) {
      await replyVoiceError(client, res, "POST /internal/voice/channels", error);
    }
  });

  app.post("/internal/voice/channels/:channelId/release", async (req: Request, res: Response) => {
    const channelId = parseChannelId(req.params.channelId);
    if (!channelId) {
      res.status(400).json({ error: "INVALID_CHANNEL_ID" });
      return;
    }
    if (refuseNotReady(client, res)) { return; }
    try {
      const { deleted } = await releaseVoiceChannel(client, channelId);
      res.json({ released: true, deleted });
    } catch (error) {
      await replyVoiceError(client, res, "POST /internal/voice/channels/:id/release", error);
    }
  });
}
