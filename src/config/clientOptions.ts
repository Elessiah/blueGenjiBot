import { GatewayIntentBits, Options, type ClientOptions, type VoiceState } from "discord.js";
import { voiceCategoryId } from "../voice/matchVoice.js";

/**
 * Garde-t-on en mémoire l'état vocal d'un membre ? Seulement sur le serveur
 * qui porte la catégorie des salons vocaux de match : l'intention
 * `GuildVoiceStates` ne sert qu'à savoir si un de ces salons est vide, pour le
 * supprimer, et à en déconnecter les occupants quand l'arbitrage le vide (rien
 * n'est compté, gardé ni rendu au site), et la présence vocale des
 * membres des serveurs partenaires n'est ni lue ni gardée.
 * @param state État vocal reçu de Discord.
 * @returns `true` pour le serveur BlueGenji de la catégorie.
 */
export function keepVoiceState(state: Pick<VoiceState, "guild">): boolean {
  return state.guild.channels.cache.has(voiceCategoryId());
}

/**
 * Options du client Discord : intentions et mentions par défaut, tirées de
 * `main.ts` pour être vérifiables sans connecter le bot.
 *
 * Mentions autorisées par défaut de **tout** envoi du bot : aucune.
 *
 * discord.js applique cette valeur à chaque `send`, `reply`, `edit`,
 * `followUp` ou `editReply` qui ne fixe pas son propre `allowedMentions`.
 * Un texte venu d'un utilisateur, d'un administrateur ou du site (`/broadcast`,
 * papiers d'adhésion, conseils, réponses) peut contenir `@everyone`, `@here`,
 * `<@&rôle>` ou `<@membre>` : il s'affiche, mais ne notifie personne. Une
 * réponse à un message ne notifie pas non plus son auteur (`repliedUser`).
 *
 * Un envoi qui doit vraiment appeler quelqu'un l'autorise lui-même, au plus
 * juste (`{ roles: [id] }`, `{ users: [id] }`, ou `everyone` pour l'annonce
 * #live, `notifications/liveAnnouncement.ts`) : son option remplace ce défaut
 * pour ce seul message.
 *
 * @returns Une copie neuve à chaque appel, que le client peut garder.
 */
export function buildClientOptions(): ClientOptions {
  return {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // Salons vocaux de match vides (`voice/matchVoice.ts`) : sans elle, le bot
      // ne sait pas qu'un salon rendu s'est vidé et `voiceStateUpdate` reste muet.
      GatewayIntentBits.GuildVoiceStates,
    ],
    allowedMentions: { parse: [], repliedUser: false },
    // États vocaux gardés pour le seul serveur de la catégorie (`keepVoiceState`).
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      VoiceStateManager: { maxSize: 0, keepOverLimit: (state) => keepVoiceState(state) },
    }),
  };
}
