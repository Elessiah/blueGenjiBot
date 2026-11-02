import { GatewayIntentBits, type ClientOptions } from "discord.js";

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
      // Occupation des salons vocaux de match (`voice/matchVoice.ts`) : sans
      // elle, l'effectif d'un salon reste vide et `voiceStateUpdate` muet.
      GatewayIntentBits.GuildVoiceStates,
    ],
    allowedMentions: { parse: [], repliedUser: false },
  };
}
