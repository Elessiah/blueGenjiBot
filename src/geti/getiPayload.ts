/**
 * Annonces GETI : les six salons sources du serveur BlueGenji et la forme
 * sous laquelle un de leurs messages est poussé au site (`doc/internal-api.md`,
 * côté site `GETI_INFO.md`).
 *
 * Deux sortes d'annonces y paraissent : celles qu'un membre écrit directement
 * dans le salon, et celles que GETI Bot relaie depuis les serveurs abonnés à
 * son réseau (un encart). Le bot ne lit rien dans le texte : il recopie le
 * message brut (contenu, auteur, encarts, dates), le site l'analyse. Sur
 * Discord, il n'écrit rien — ni réponse, ni réaction, ni modification.
 */

/** Compte Discord de GETI Bot : le seul bot dont les messages sont des annonces (même valeur que le site, `GETI_BOT_USER_ID`). */
export const GETI_BOT_USER_ID = "357980843001511937";

/** Un salon source : sa catégorie d'annonces et la durée de garde de celle-ci sur le site. */
export type GetiChannel = { id: string; category: string; retentionDays: number };

/**
 * Salons sources (mêmes identifiants et mêmes durées que le site,
 * `GETI_CHANNEL_IDS` et `GETI_RETENTION_DAYS`) : une recherche de scrim vit
 * 7 jours, les autres 14 — le rattrapage d'un salon ne remonte pas plus loin.
 */
export const GETI_CHANNELS: readonly GetiChannel[] = [
  { id: "679323677874978826", category: "lfp", retentionDays: 14 }, // je cherche un joueur
  { id: "679323773559635999", category: "lft", retentionDays: 14 }, // je cherche une équipe
  { id: "679323726717911090", category: "lfsub", retentionDays: 14 }, // je cherche un remplaçant
  { id: "679323814106103819", category: "lfstaff", retentionDays: 14 }, // je cherche un staff
  { id: "930074663340605451", category: "lfs", retentionDays: 7 }, // je cherche un scrim
  { id: "1085116755925536828", category: "lfcast", retentionDays: 14 }, // je cherche un cast
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Annonces d'un appel au site (même borne que le site, `GETI_UPSERT_MAX_POSTS`). */
export const GETI_BATCH_MAX_POSTS = 20;
/** Octets d'un lot : sous le plafond du corps accepté par le site (512 Kio). */
export const GETI_BATCH_MAX_BYTES = 200_000;
/** Identifiants d'un appel de suppression (même borne que le site). */
export const GETI_DELETE_MAX_IDS = 100;

/** Bornes de Discord, appliquées ici aussi : le site écarterait un message plus lourd. */
const CONTENT_MAX = 4000;
const EMBEDS_MAX = 10;
const EMBED_FIELDS_MAX = 25;

/** Auteur d'un message Discord, réduit à ce que le site lit. */
export type GetiWireAuthor = { id: string | null; username: string | null; discriminator: string | null; bot: boolean };

export type GetiWireEmbed = {
  authorName: string | null;
  title: string | null;
  description: string | null;
  fields: { name: string; value: string }[];
  footerText: string | null;
};

/** Un message d'un salon source, tel qu'il part vers le site. */
export type GetiWirePost = {
  id: string;
  channelId: string;
  content: string;
  author: GetiWireAuthor;
  embeds: GetiWireEmbed[];
  postedAt: string;
  editedAt: string | null;
};

/** Ce que le relais lit d'un utilisateur Discord. */
export type GetiSourceUser = { id: string; username: string; discriminator?: string | null; bot?: boolean | null };

/** Ce que le relais lit d'un encart Discord. */
export type GetiSourceEmbed = {
  author?: { name?: string | null } | null;
  title?: string | null;
  description?: string | null;
  fields?: readonly { name: string; value: string }[] | null;
  footer?: { text?: string | null } | null;
};

/** Ce que le relais lit d'un message Discord (un `Message` complet le satisfait). */
export type GetiSourceMessage = {
  id: string;
  channelId: string;
  content?: string | null;
  author?: GetiSourceUser | null;
  embeds?: readonly GetiSourceEmbed[] | null;
  createdTimestamp: number;
  editedTimestamp?: number | null;
  system?: boolean | null;
};

/**
 * @param channelId Identifiant d'un salon Discord.
 * @returns Le salon source, ou `null` pour tout autre salon.
 */
export function getiChannel(channelId: string | null | undefined): GetiChannel | null {
  return GETI_CHANNELS.find((channel) => channel.id === channelId) ?? null;
}

/**
 * @param channelId Identifiant d'un salon Discord.
 * @returns `true` pour l'un des six salons sources.
 */
export function isGetiChannel(channelId: string | null | undefined): boolean {
  return getiChannel(channelId) !== null;
}

/**
 * @param channel Salon source.
 * @returns Sa durée de garde, en millisecondes.
 */
export function getiRetentionMs(channel: GetiChannel): number {
  return channel.retentionDays * DAY_MS;
}

/** Début d'un relais de GETI Bot : la mention de l'auteur de l'annonce (« <@id>*(pseudo)* sur … »). */
const GETI_RELAY_HEADER_START = /^\s*<@!?\d{15,22}>/u;

/**
 * Le message de GETI Bot est-il un relais d'annonce ? Un relais ouvre son
 * premier encart sur la mention de l'auteur ; ses autres messages (« Ton
 * annonce a été publié dans … », l'avis qui suit une annonce directe) n'en
 * sont pas — même règle que le site (`isGetiRelay`).
 * @param embeds Encarts du message.
 * @returns `true` pour un relais.
 */
export function isGetiRelayMessage(embeds: readonly GetiSourceEmbed[] | null | undefined): boolean {
  const description = embeds?.[0]?.description;
  return typeof description === "string" && GETI_RELAY_HEADER_START.test(description);
}

/**
 * Un message à pousser ? Ceux des six salons écrits par un membre, et les
 * relais de GETI Bot. Sont laissés : les messages système (épingle, arrivée
 * d'un membre…), les avis de GETI Bot qui ne sont pas des relais, les messages
 * de tout autre bot (le nôtre compris) et ceux sans auteur connu.
 * @param message Message reçu de Discord.
 * @returns `true` si le message part vers le site.
 */
export function isGetiPost(message: Pick<GetiSourceMessage, "channelId" | "system" | "author" | "embeds">): boolean {
  if (!isGetiChannel(message.channelId) || message.system === true) { return false; }
  const author = message.author;
  if (!author) { return false; }
  if (author.bot !== true) { return true; }
  return author.id === GETI_BOT_USER_ID && isGetiRelayMessage(message.embeds);
}

function wireEmbed(embed: GetiSourceEmbed): GetiWireEmbed {
  return {
    authorName: embed.author?.name ?? null,
    title: embed.title ?? null,
    description: embed.description ?? null,
    fields: (embed.fields ?? []).slice(0, EMBED_FIELDS_MAX).map((field) => ({ name: field.name, value: field.value })),
    footerText: embed.footer?.text ?? null,
  };
}

/**
 * Recopie un message Discord dans la forme attendue par le site.
 * @param message Message d'un salon source.
 * @returns Le corps d'une annonce.
 */
export function toGetiWirePost(message: GetiSourceMessage): GetiWirePost {
  const author = message.author;
  return {
    id: message.id,
    channelId: message.channelId,
    content: (message.content ?? "").slice(0, CONTENT_MAX),
    author: {
      id: author?.id ?? null,
      username: author?.username ?? null,
      discriminator: author?.discriminator ?? null,
      bot: author?.bot === true,
    },
    embeds: (message.embeds ?? []).slice(0, EMBEDS_MAX).map(wireEmbed),
    postedAt: new Date(message.createdTimestamp).toISOString(),
    editedAt: typeof message.editedTimestamp === "number" ? new Date(message.editedTimestamp).toISOString() : null,
  };
}

/**
 * Découpe des annonces en lots : {@link GETI_BATCH_MAX_POSTS} au plus, et
 * {@link GETI_BATCH_MAX_BYTES} octets de JSON au plus (une annonce seule plus
 * lourde part dans son propre lot — le site l'écartera sans refuser les autres).
 * @param posts Annonces à pousser.
 * @returns Les lots, dans l'ordre.
 */
export function batchGetiPosts(posts: readonly GetiWirePost[]): GetiWirePost[][] {
  const batches: GetiWirePost[][] = [];
  let current: GetiWirePost[] = [];
  let bytes = 0;
  for (const post of posts) {
    const size = Buffer.byteLength(JSON.stringify(post), "utf8");
    if (current.length > 0 && (current.length >= GETI_BATCH_MAX_POSTS || bytes + size > GETI_BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(post);
    bytes += size;
  }
  if (current.length > 0) { batches.push(current); }
  return batches;
}
