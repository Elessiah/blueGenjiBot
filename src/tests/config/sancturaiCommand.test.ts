import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { commands, globalCommands } from "../../config/commands.js";

test("/sancturai-reply : commande globale des MP du bot, texte borné à 4 000", () => {
  const params = globalCommands["sancturai-reply"].parameters as {
    contexts?: number[];
    integration_types?: number[];
    options: { name: string; max_length?: number }[];
  };
  // Les notifications SancturAI arrivent en MP : la commande doit y être disponible, et seulement là.
  assert.deepEqual(params.contexts, [InteractionContextType.BotDM]);
  // Installation sur le profil seulement : seuls les comptes qui ont installé l'app (le propriétaire) la voient.
  assert.deepEqual(params.integration_types, [ApplicationIntegrationType.UserInstall]);
  assert.equal(params.options.find((o) => o.name === "texte")?.max_length, 4000);
  // « #ab12cd » : 6 hexa + le « # » optionnel
  assert.equal(params.options.find((o) => o.name === "id")?.max_length, 7);
});

test("/sancturai-reply n'est plus enregistrée par serveur (pas de doublon)", () => {
  assert.equal("sancturai-reply" in commands, false);
});
