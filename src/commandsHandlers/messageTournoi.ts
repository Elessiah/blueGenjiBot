/**
 * Handler de `/message-tournoi` : le staff des tournois écrit aux participants
 * d'un tournoi du site BlueGenji (`doc/internal-api.md` § Appel du bot vers le
 * site ; côté site, `docs/features/TOURNAMENT_STAFF_MESSAGE.md`).
 *
 * 1. le tournoi (numéro ou lien) est lu ici, le site le valide ;
 * 2. réponse **éphémère** : aperçu du message, destinataires comptés par le
 *    site, menu des catégories (Discord n'offre pas d'option à choix multiples)
 *    et boutons Envoyer / Annuler — cet aperçu est la confirmation de l'envoi ;
 * 3. Envoyer : le site relit tout (compte rattaché, permission `tournaments`,
 *    état du tournoi, engagés) et distribue ; le bot affiche le bilan compté.
 *
 * Seul l'auteur se sert du panneau ; il expire au bout de cinq minutes, et ses
 * composants sont retirés après l'envoi, l'annulation ou l'échéance. Un site
 * injoignable donne un message, jamais une exception ; un aperçu en échec
 * passager garde le panneau sur la sélection précédente.
 */

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type MessageComponentInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
import {
  normalizeCategories,
  previewStaffMessage,
  sendStaffMessage,
  siteConfig,
  SITE_NOT_CONFIGURED,
  type SiteConfig,
  type SiteResult,
  type StaffMessageCall,
  type StaffMessageCategory,
  type StaffMessagePreview,
  type StaffMessageSent,
} from "../tournament/siteStaffMessage.js";
import {
  customIds,
  fixedText,
  isTransientRefusal,
  langOf,
  PANEL_LIFETIME_MS,
  previewPanel,
  refusalText,
  sentText,
  type Lang,
} from "../tournament/staffMessageView.js";
import { linkPointsElsewhere, parseTournamentReference } from "../tournament/tournamentReference.js";

/** Ce dont le handler dépend, remplacé dans les tests. */
export type MessageTournoiDeps = {
  config: () => SiteConfig | null;
  preview: (config: SiteConfig, call: StaffMessageCall) => Promise<SiteResult<StaffMessagePreview>>;
  send: (config: SiteConfig, call: StaffMessageCall) => Promise<SiteResult<StaffMessageSent>>;
  now: () => number;
  lifetimeMs: number;
};

const DEFAULT_DEPS: MessageTournoiDeps = {
  config: () => siteConfig(),
  preview: (config, call) => previewStaffMessage(config, call),
  send: (config, call) => sendStaffMessage(config, call),
  now: () => Date.now(),
  lifetimeMs: PANEL_LIFETIME_MS,
};

/**
 * @param client Client Discord (journal d'erreurs).
 * @param interaction Interaction `/message-tournoi` (options `tournoi` et `message`).
 */
export async function messageTournoi(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  await runMessageTournoi(client, interaction, DEFAULT_DEPS);
}

/** État d'un panneau ouvert. */
type Panel = {
  lang: Lang;
  config: SiteConfig;
  call: StaffMessageCall;
  expiresAt: number;
  nonce: string;
  /** Rang du dernier aperçu demandé : une réponse plus ancienne ne l'écrase pas. */
  previewSeq: number;
  /** Dernière sélection que le site a comptée, et son aperçu : le repli d'un aperçu en échec passager. */
  confirmed: { call: StaffMessageCall; preview: StaffMessagePreview };
  done: boolean;
};

/**
 * Corps du handler, ses dépendances passées en paramètre.
 * @param client Client Discord (journal d'erreurs).
 * @param interaction Interaction `/message-tournoi`.
 * @param deps Configuration du site, appels et horloge.
 */
export async function runMessageTournoi(client: Client, interaction: ChatInputCommandInteraction, deps: MessageTournoiDeps): Promise<void> {
  const lang = langOf(interaction.locale);
  try {
    const reference = interaction.options.getString("tournoi", true);
    const tournamentId = parseTournamentReference(reference);
    if (tournamentId === null) {
      await safeReply(interaction, fixedText("badReference", lang), true, false);
      return;
    }
    const config = deps.config();
    if (!config) {
      await safeReply(interaction, refusalText(SITE_NOT_CONFIGURED, lang), true, false);
      return;
    }
    // L'aperçu interroge le site : Discord n'attend que 3 s sans accusé.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const call: StaffMessageCall = {
      discordId: interaction.user.id,
      tournamentId,
      categories: ["ALL"],
      message: interaction.options.getString("message", true),
    };
    const first = await deps.preview(config, call);
    if (!first.ok) {
      await safeReply(interaction, refusalText(first.code, lang), true, true);
      return;
    }
    // Un lien vers un autre site au chemin semblable (`/tournois/12`) ne désigne
    // pas le tournoi BlueGenji de ce numéro : refusé avant tout panneau.
    if (linkPointsElsewhere(reference, first.data.linkBase)) {
      await safeReply(interaction, fixedText("foreignLink", lang), true, true);
      return;
    }
    const panel: Panel = {
      lang,
      config,
      call,
      expiresAt: Math.floor((deps.now() + deps.lifetimeMs) / 1000),
      nonce: interaction.id,
      previewSeq: 0,
      confirmed: { call, preview: first.data },
      done: false,
    };
    const message = await interaction.editReply(panelView(panel, first.data));
    const collector = message.createMessageComponentCollector({ time: deps.lifetimeMs });
    collector.on("collect", (component: MessageComponentInteraction) => {
      // Listener hors de la pile de la commande : sa propre garde.
      void onComponent(client, interaction, panel, deps, collector, component).catch((error) =>
        sendLog(client, `messageTournoi composant : ${(error as Error).message}`),
      );
    });
    collector.on("end", (_collected, reason) => {
      void onEnd(interaction, panel, reason).catch((error) => sendLog(client, `messageTournoi fin : ${(error as Error).message}`));
    });
  } catch (err) {
    await sendLog(client, `messageTournoi error: ${(err as Error).message}`);
    await safeReply(interaction, fixedText("failed", lang), true, interaction.deferred || interaction.replied);
  }
}

function panelView(panel: Panel, preview: StaffMessagePreview) {
  return previewPanel({
    preview,
    message: panel.call.message,
    categories: panel.call.categories,
    expiresAt: panel.expiresAt,
    lang: panel.lang,
    nonce: panel.nonce,
  });
}

async function onComponent(
  client: Client,
  interaction: ChatInputCommandInteraction,
  panel: Panel,
  deps: MessageTournoiDeps,
  collector: { stop: (reason?: string) => void },
  component: MessageComponentInteraction,
): Promise<void> {
  if (component.user.id !== interaction.user.id) {
    await component.reply({ content: fixedText("notAuthor", panel.lang), flags: MessageFlags.Ephemeral });
    return;
  }
  if (panel.done) {
    // Clic arrivé après l'envoi, l'annulation ou l'échéance : accusé sans effet,
    // sans quoi Discord afficherait « Échec de l'interaction ».
    await acknowledge(component);
    return;
  }
  const ids = customIds(panel.nonce);
  if (component.customId === ids.cancel) {
    panel.done = true;
    collector.stop("cancel");
    await component.update({ content: fixedText("cancelled", panel.lang), components: [] });
    return;
  }
  if (component.customId === ids.send) {
    // L'aperçu est la confirmation : une sélection que le site n'a pas encore
    // comptée ne part pas — ni l'ancienne, ni la nouvelle à l'aveugle.
    if (panel.call !== panel.confirmed.call) {
      await component.reply({ content: fixedText("counting", panel.lang), flags: MessageFlags.Ephemeral });
      return;
    }
    panel.done = true;
    collector.stop("send");
    await component.update({ content: fixedText("sending", panel.lang), components: [] });
    const result = await deps.send(panel.config, panel.call);
    await interaction.editReply({
      content: result.ok ? sentText(result.data, panel.lang) : refusalText(result.code, panel.lang, true),
      components: [],
    });
    return;
  }
  if (component.customId === ids.select && component.isStringSelectMenu()) {
    await onSelect(interaction, panel, deps, collector, component);
    return;
  }
  await acknowledge(component);
  await sendLog(client, `messageTournoi : composant inattendu ${component.customId}`);
}

/** Sélection changée : le site recompte ; un échec passager rend la sélection précédente. */
async function onSelect(
  interaction: ChatInputCommandInteraction,
  panel: Panel,
  deps: MessageTournoiDeps,
  collector: { stop: (reason?: string) => void },
  component: StringSelectMenuInteraction,
): Promise<void> {
  // La sélection est prise **avant** toute attente : un « Envoyer » cliqué
  // pendant l'accusé partirait sinon vers l'ancienne sélection.
  // « Tous » est coché à l'ouverture : en cocher d'autres par-dessus veut dire « seulement
  // ceux-là », pas « tous » — sans quoi le compte ne bouge pas et l'envoi part à tout le monde.
  const narrowing = panel.call.categories.includes("ALL") && component.values.length > 1;
  const picked = narrowing ? component.values.filter((value) => value !== "ALL") : component.values;
  const categories: StaffMessageCategory[] | null = normalizeCategories(picked);
  // Rien de connu dans le menu : la sélection reste celle d'avant, jamais « tous ».
  if (categories === null) {
    await acknowledge(component);
    return;
  }
  panel.call = { ...panel.call, categories };
  const call = panel.call;
  const seq = ++panel.previewSeq;
  await component.deferUpdate();
  const result = await deps.preview(panel.config, call);
  // Un envoi, une annulation ou un aperçu plus récent l'ont devancé : rien à réécrire.
  if (panel.done || seq !== panel.previewSeq) { return; }
  if (!result.ok && isTransientRefusal(result.code)) {
    // Échec passager : le panneau revient à la dernière sélection comptée, et l'auteur l'apprend à part.
    panel.call = panel.confirmed.call;
    await interaction.editReply(panelView(panel, panel.confirmed.preview));
    await component.followUp({ content: refusalText(result.code, panel.lang), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!result.ok) {
    await interaction.editReply({ content: refusalText(result.code, panel.lang), components: [] });
    panel.done = true;
    collector.stop("refused");
    return;
  }
  panel.confirmed = { call, preview: result.data };
  await interaction.editReply(panelView(panel, result.data));
}

/** Accuse un composant sans rien changer ; un accusé déjà fait ou expiré n'est pas une panne. */
async function acknowledge(component: MessageComponentInteraction): Promise<void> {
  try {
    await component.deferUpdate();
  } catch {
    // Interaction déjà accusée ou expirée : rien à faire.
  }
}

async function onEnd(interaction: ChatInputCommandInteraction, panel: Panel, reason: string): Promise<void> {
  // Envoi, annulation et refus ont déjà écrit leur dernier mot.
  if (reason !== "time" || panel.done) { return; }
  panel.done = true;
  await interaction.editReply({ content: fixedText("expired", panel.lang), components: [] });
}
