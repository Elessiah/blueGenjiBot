import test from "node:test";
import assert from "node:assert/strict";
import { commands } from "../../config/commands.js";

test("/sancturai-reply : masquée aux non-administrateurs, texte borné à 4 000", () => {
  const params = commands["sancturai-reply"].parameters as {
    default_member_permissions?: string;
    options: { name: string; max_length?: number }[];
  };
  assert.equal(params.default_member_permissions, "0");
  assert.equal(params.options.find((o) => o.name === "texte")?.max_length, 4000);
});
