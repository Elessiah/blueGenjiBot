import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import { formatDiskUsage, getDiskUsage } from "../../backup/diskSpace.js";

test("getDiskUsage renvoie un volume cohérent pour un chemin existant", async () => {
  const usage = await getDiskUsage(os.tmpdir());

  assert.notEqual(usage, null);
  assert.ok(usage!.total > 0);
  assert.ok(usage!.free >= 0);
  assert.ok(usage!.free <= usage!.total);
  assert.ok(usage!.usedRatio >= 0 && usage!.usedRatio <= 1);
});

test("getDiskUsage renvoie null sur un chemin inexistant", async () => {
  const usage = await getDiskUsage("/chemin/qui/n/existe/pas/bluegenji");

  assert.equal(usage, null);
});

test("formatDiskUsage signale l'absence de mesure", () => {
  assert.equal(formatDiskUsage(null), "💾 Espace disque : indisponible.");
});

test("formatDiskUsage affiche libre et total en unités lisibles", () => {
  const total = 32 * 1024 ** 3;
  const used = 8 * 1024 ** 3;
  const line = formatDiskUsage({ total, used, free: total - used, usedRatio: used / total });

  assert.match(line, /^💾 /);
  assert.match(line, /24,0 Go libres sur 32,0 Go/);
  assert.match(line, /25 % utilisé/);
});

test("formatDiskUsage alerte quand le disque est presque plein", () => {
  const total = 32 * 1024 ** 3;
  const used = 31 * 1024 ** 3;
  const line = formatDiskUsage({ total, used, free: total - used, usedRatio: used / total });

  assert.match(line, /^⚠️ /);
  assert.match(line, /Pense à faire de la place/);
});

test("formatDiskUsage alerte sous 1 Go libre même sur un gros volume", () => {
  const total = 1024 ** 4;
  const free = 512 * 1024 ** 2;
  const line = formatDiskUsage({ total, used: total - free, free, usedRatio: (total - free) / total });

  assert.match(line, /^⚠️ /);
  assert.match(line, /512,0 Mo libres sur 1,0 To/);
});
