import { ChannelType, type Client } from "discord.js";

/**
 * Client Discord simulé pour les salons vocaux de match : une catégorie, ses
 * salons vocaux (effectif réglable), le salon de logs et le titulaire. Les
 * pannes se règlent sur `world`.
 */

/** Salon vocal simulé. */
export type FakeVoice = {
  id: string;
  /** Absent : salon dont le serveur n'a pu être lu. */
  guildId?: string;
  type: ChannelType;
  parentId: string;
  name: string;
  members: { size: number };
  delete: (reason?: string) => Promise<unknown>;
};

/** Serveur simulé, celui de la catégorie et de ses salons. */
export const FAKE_GUILD_ID = "500000000000000001";

/** Erreur Discord codée, comme une `DiscordAPIError`. */
export function discordError(code: number, message = `Discord ${code}`): Error {
  return Object.assign(new Error(message), { code });
}

export type World = {
  voices: Map<string, FakeVoice>;
  /** Options de chaque création demandée. */
  creations: Record<string, unknown>[];
  /** Identifiants supprimés par le bot. */
  deletions: string[];
  /** Textes envoyés au salon de logs. */
  logs: string[];
  /** Erreur levée par la création d'un salon. */
  createError: Error | null;
  /** Erreur levée par la suppression d'un salon. */
  deleteError: Error | null;
  /** Erreur levée par la lecture d'un salon vocal. */
  fetchVoiceError: Error | null;
  /** État de la catégorie. */
  category: "ok" | "missing" | "text";
  ready: boolean;
  nextId: bigint;
};

export const world: World = {
  voices: new Map(),
  creations: [],
  deletions: [],
  logs: [],
  createError: null,
  deleteError: null,
  fetchVoiceError: null,
  category: "ok",
  ready: true,
  nextId: 300000000000000000n,
};

/** Remet le monde simulé à vide. */
export function resetWorld(): void {
  world.voices.clear();
  world.creations.length = 0;
  world.deletions.length = 0;
  world.logs.length = 0;
  world.createError = null;
  world.deleteError = null;
  world.fetchVoiceError = null;
  world.category = "ok";
  world.ready = true;
}

/**
 * Ajoute un salon vocal au monde simulé.
 * @param id Identifiant.
 * @param members Effectif.
 * @param parentId Catégorie.
 * @returns Le salon.
 */
export function addVoice(id: string, members: number, parentId: string): FakeVoice {
  const voice: FakeVoice = {
    id,
    guildId: FAKE_GUILD_ID,
    type: ChannelType.GuildVoice,
    parentId,
    name: "salon",
    members: { size: members },
    delete: async () => {
      if (world.deleteError) { throw world.deleteError; }
      world.voices.delete(id);
      world.deletions.push(id);
      return voice;
    },
  };
  world.voices.set(id, voice);
  return voice;
}

/**
 * Client simulé.
 * @param categoryId Catégorie servie.
 * @param logChannelId Salon de logs (`INFO_SERV`).
 * @returns Le client.
 */
export function fakeVoiceClient(categoryId: string, logChannelId: string): Client {
  const guild = {
    id: FAKE_GUILD_ID,
    channels: {
      create: async (options: Record<string, unknown>) => {
        world.creations.push(options);
        if (world.createError) { throw world.createError; }
        const id = String(world.nextId++);
        const voice = addVoice(id, 0, String(options.parent));
        voice.name = String(options.name);
        return voice;
      },
    },
  };
  return {
    isReady: () => world.ready,
    users: {
      fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }),
    },
    channels: {
      fetch: async (id: string) => {
        if (id === logChannelId) {
          return {
            send: async (payload: string | { content: string }) => {
              world.logs.push(typeof payload === "string" ? payload : payload.content);
              return { id: "log" };
            },
          };
        }
        if (id === categoryId) {
          if (world.category === "missing") { throw discordError(10003, "Unknown Channel"); }
          const type = world.category === "text" ? ChannelType.GuildText : ChannelType.GuildCategory;
          return { id, type, guild };
        }
        if (world.fetchVoiceError) { throw world.fetchVoiceError; }
        const voice = world.voices.get(id);
        if (!voice) { throw discordError(10003, "Unknown Channel"); }
        return voice;
      },
    },
  } as unknown as Client;
}
