import test from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import {
  absDelta,
  deterministicColor,
  isLoopbackHost,
  matchesToken,
  relayStatus,
  sparklineFromBuckets,
  SPARKLINE_POINTS,
  asyncRoute,
  internalErrorHandler,
  internalErrorLogLine,
  internalErrorReply,
  unwrappedRoutes,
  wrapUnwrappedRoutes,
  ROUTER_STACK_NOT_FOUND,
} from "../../internalApi/helpers.js";
import type { AddressInfo } from "node:net";

test("absDelta formate le signe correctement", () => {
  assert.equal(absDelta(15, 12), "+3");
  assert.equal(absDelta(10, 15), "-5");
  assert.equal(absDelta(7, 7), "+0");
});

test("deterministicColor renvoie une couleur HSL valide et stable pour le meme id", () => {
  const c1 = deterministicColor("123456789012345678");
  const c2 = deterministicColor("123456789012345678");
  assert.equal(c1, c2);
  assert.match(c1, /^hsl\(\d+, 65%, 50%\)$/);
});

test("deterministicColor donne des couleurs differentes pour des ids differents (probabilite)", () => {
  const c1 = deterministicColor("aaaaaaaaaaaaaaaaaa");
  const c2 = deterministicColor("zzzzzzzzzzzzzzzzzz");
  assert.notEqual(c1, c2);
});

test("deterministicColor accepte une string vide sans crash", () => {
  const c = deterministicColor("");
  assert.match(c, /^hsl\(\d+, 65%, 50%\)$/);
});

test("isLoopbackHost reconnait les adresses confinees a la machine", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackHost("::FFFF:127.0.0.1"), true);
});

test("isLoopbackHost refuse une IPv4 mappee qui n'est pas la boucle locale", () => {
  assert.equal(isLoopbackHost("::ffff:10.0.0.1"), false);
  assert.equal(isLoopbackHost("::ffff:0.0.0.0"), false);
  assert.equal(isLoopbackHost("::ffff:"), false);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("::"), false);
});

test("deterministicColor garde les teintes calculees avant le passage a Int32Array", () => {
  // Valeurs de l'ancien `(h * 31 + charCodeAt) | 0` : une couleur deja vue
  // sur la page publique ne doit pas changer.
  assert.equal(deterministicColor("123456789012345678"), "hsl(49, 65%, 50%)");
  assert.equal(deterministicColor("1098765432109876543"), "hsl(196, 65%, 50%)");
  assert.equal(deterministicColor("aaaaaaaaaaaaaaaaaa"), "hsl(24, 65%, 50%)");
  assert.equal(deterministicColor(""), "hsl(0, 65%, 50%)");
});

test("isLoopbackHost retient la valeur par defaut de startInternalApi", () => {
  // `INTERNAL_API_HOST` absente OU vide vaut 127.0.0.1 des deux cotes :
  // `startInternalApi` replie avec `||`, qui traite aussi "" comme absente.
  // Si les deux divergeaient, la garde raisonnerait sur une interface non
  // ecoutee.
  assert.equal(isLoopbackHost(undefined), true);
  assert.equal(isLoopbackHost(""), true);
});

test("isLoopbackHost refuse une ecoute ouverte sur le reseau", () => {
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("::"), false);
  assert.equal(isLoopbackHost("192.168.1.22"), false);
});

test("matchesToken accepte le jeton exact et rien d'autre", () => {
  assert.equal(matchesToken("s3cret", "s3cret"), true);
  assert.equal(matchesToken("s3creT", "s3cret"), false);
  assert.equal(matchesToken("", "s3cret"), false);
});

test("matchesToken refuse un header absent", () => {
  assert.equal(matchesToken(undefined, "s3cret"), false);
});

test("matchesToken supporte des longueurs differentes sans lever", () => {
  // Les deux valeurs sont hachees avant comparaison : `timingSafeEqual` leve
  // sur deux tampons de tailles differentes, et cette levee serait un canal.
  assert.equal(matchesToken("court", "un jeton nettement plus long"), false);
  assert.equal(matchesToken("un jeton nettement plus long", "court"), false);
});

test("relayStatus : ok sous 24 h, lag sous 7 jours, off au-delà ou sans relais", () => {
  assert.equal(relayStatus(null), "off");
  assert.equal(relayStatus(undefined), "off");
  assert.equal(relayStatus(0), "ok");
  assert.equal(relayStatus(23.99), "ok");
  assert.equal(relayStatus(24), "lag");
  assert.equal(relayStatus(24 * 7 - 0.01), "lag");
  assert.equal(relayStatus(24 * 7), "off");
  assert.equal(relayStatus(Number.NaN), "off");
});

test("sparklineFromBuckets range la tranche la plus récente en dernier et ignore les tranches hors courbe", () => {
  assert.equal(SPARKLINE_POINTS, 10);
  assert.deepEqual(sparklineFromBuckets([]), new Array(10).fill(0));
  assert.deepEqual(
    sparklineFromBuckets([
      { bucket: 0, count: 5 },
      { bucket: 9, count: 1 },
      { bucket: 3, count: "7" as unknown as number },
      { bucket: 10, count: 99 },
      { bucket: -1, count: 99 },
    ]),
    [1, 0, 0, 0, 0, 0, 7, 0, 0, 5],
  );
});

test("internalErrorReply_bodyParserRefusal_returnsItsCodeAndStatus", () => {
  assert.deepEqual(internalErrorReply({ type: "entity.parse.failed", status: 400 }), { code: "INVALID_JSON", status: 400 });
  assert.deepEqual(internalErrorReply({ type: "entity.too.large", status: 413 }), { code: "PAYLOAD_TOO_LARGE", status: 413 });
  assert.deepEqual(internalErrorReply({ type: "encoding.unsupported", status: 415 }), { code: "UNSUPPORTED_ENCODING", status: 415 });
  assert.deepEqual(internalErrorReply({ type: "charset.unsupported", status: 415 }), { code: "UNSUPPORTED_ENCODING", status: 415 });
  assert.deepEqual(internalErrorReply({ type: "request.aborted", status: 400 }), { code: "REQUEST_ABORTED", status: 400 });
  assert.deepEqual(internalErrorReply({ type: "request.size.invalid", status: 400 }), { code: "INVALID_CONTENT_LENGTH", status: 400 });
});

test("internalErrorReply_foreignErrorWith4xxStatus_returns500", () => {
  // Une erreur Discord (« Unknown Channel ») porte un `status` 404 : jamais repris.
  assert.deepEqual(internalErrorReply({ status: 404, code: 10003 }), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorReply_unknownOrInheritedType_returns500", () => {
  assert.deepEqual(internalErrorReply({ type: "toString" }), { code: "INTERNAL_ERROR", status: 500 });
  assert.deepEqual(internalErrorReply({ type: "stream.not.readable", status: 500 }), { code: "INTERNAL_ERROR", status: 500 });
  assert.deepEqual(internalErrorReply({ type: "entity.verify.failed", status: 403 }), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorReply_bodyParserTypeWithWrongStatus_returns500", () => {
  // Même `type` que body-parser sans son statut : une erreur du serveur, jamais un refus.
  assert.deepEqual(internalErrorReply({ type: "entity.parse.failed", status: 500 }), { code: "INTERNAL_ERROR", status: 500 });
  assert.deepEqual(internalErrorReply({ type: "request.aborted" }), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorReply_nullOrPlainError_returns500", () => {
  assert.deepEqual(internalErrorReply(null), { code: "INTERNAL_ERROR", status: 500 });
  assert.deepEqual(internalErrorReply(new Error("x")), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorLogLine_bodyParserRefusal_returnsCodeOnly", () => {
  const error = Object.assign(new SyntaxError('"{Equipe Bleue" is not valid JSON'), { type: "entity.parse.failed", status: 400 });

  assert.equal(internalErrorLogLine(error), "[internalApi] INVALID_JSON");
});

test("internalErrorLogLine_unexpectedError_returnsNameAndCodeWithoutMessage", () => {
  const error = Object.assign(new Error("UNIQUE constraint failed: Team.name 'Equipe Bleue'"), { code: "SQLITE_CONSTRAINT" });

  assert.equal(internalErrorLogLine(error), "[internalApi] INTERNAL_ERROR (Error, code SQLITE_CONSTRAINT)");
});

test("internalErrorLogLine_codeWithSpaces_dropsCode", () => {
  const error = Object.assign(new TypeError("x"), { code: "texte libre d'un joueur" });

  assert.equal(internalErrorLogLine(error), "[internalApi] INTERNAL_ERROR (TypeError, code inconnu)");
});

test("internalErrorLogLine_nonError_returnsItsType", () => {
  assert.equal(internalErrorLogLine("Equipe Bleue"), "[internalApi] INTERNAL_ERROR (string, code inconnu)");
});

/** Réponse Express factice : retient ce qui lui est écrit. */
function fakeResponse(headersSent: boolean, writableEnded = false) {
  const written = { status: 0, json: undefined as unknown, destroyed: false };
  const res = {
    headersSent,
    writableEnded,
    status(code: number) { written.status = code; return res; },
    json(body: unknown) { written.json = body; return res; },
    destroy() { written.destroyed = true; return res; },
  };
  return { res: res as unknown as Response, written };
}

test("internalErrorHandler_unexpectedError_replies500AndLogs", () => {
  const lines: string[] = [];
  const { res, written } = fakeResponse(false);

  internalErrorHandler({ error: (line) => lines.push(line) })(new Error("secret"), {} as Request, res, () => undefined);

  assert.deepEqual(written, { status: 500, json: { error: "INTERNAL_ERROR" }, destroyed: false });
  assert.deepEqual(lines, ["[internalApi] INTERNAL_ERROR (Error, code inconnu)"]);
});

test("internalErrorHandler_headersAlreadySent_destroysSocketWithoutBodyNorNext", () => {
  const lines: string[] = [];
  const { res, written } = fakeResponse(true);
  let nextCalled = false;

  internalErrorHandler({ error: (line) => lines.push(line) })(new Error("x"), {} as Request, res, () => { nextCalled = true; });

  // Connexion coupée : le lecteur voit une réponse tronquée, jamais une fin normale.
  assert.deepEqual(written, { status: 0, json: undefined, destroyed: true });
  assert.equal(nextCalled, false);
  assert.deepEqual(lines, ["[internalApi] INTERNAL_ERROR (Error, code inconnu)"]);
});

test("internalErrorLogLine_freeTextName_fallsBackToError", () => {
  const error = Object.assign(new Error("x"), { name: "Equipe Bleue a triché" });

  assert.equal(internalErrorLogLine(error), "[internalApi] INTERNAL_ERROR (Error, code inconnu)");
});

test("internalErrorHandler_destroyThrowsAfterHeadersSent_swallowsIt", () => {
  const res = { headersSent: true, destroy() { throw new Error("socket closed"); } } as unknown as Response;

  assert.doesNotThrow(() => internalErrorHandler({ error: () => undefined })(new Error("x"), {} as Request, res, () => undefined));
});

test("internalErrorReply_throwingTypeGetter_returns500", () => {
  const error = { get type(): string { throw new Error("revoked"); } };

  assert.deepEqual(internalErrorReply(error), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorReply_exposedClientErrorWithoutType_returnsInvalidBody", () => {
  // Flux gzip corrompu : body-parser lève un 400 exposé, sans `type` listé.
  assert.deepEqual(internalErrorReply({ expose: true, status: 400 }), { code: "INVALID_BODY", status: 400 });
});

test("internalErrorReply_exposedWith5xx_returns500", () => {
  assert.deepEqual(internalErrorReply({ expose: true, status: 502 }), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorReply_exposedFlagNotTrue_returns500", () => {
  assert.deepEqual(internalErrorReply({ expose: "true", status: 400 }), { code: "INTERNAL_ERROR", status: 500 });
});

test("internalErrorHandler_clientRefusal_warnsWithoutErrorNorReport", () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reports: string[] = [];
  const { res, written } = fakeResponse(false);

  internalErrorHandler({ error: (l) => errors.push(l), warn: (l) => warnings.push(l), report: (l) => reports.push(l) })(
    { type: "request.aborted", status: 400 }, {} as Request, res, () => undefined,
  );

  assert.deepEqual(written, { status: 400, json: { error: "REQUEST_ABORTED" }, destroyed: false });
  assert.deepEqual(warnings, ["[internalApi] REQUEST_ABORTED"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(reports, []);
});

test("internalErrorHandler_unexpectedError_reportsSameLine", () => {
  const reports: string[] = [];
  const { res } = fakeResponse(false);

  internalErrorHandler({ error: () => undefined, report: (l) => reports.push(l) })(
    Object.assign(new Error("secret Equipe Bleue"), { code: "SQLITE_BUSY" }), {} as Request, res, () => undefined,
  );

  assert.deepEqual(reports, ["[internalApi] INTERNAL_ERROR (Error, code SQLITE_BUSY)"]);
});

test("internalErrorHandler_throwingReport_stillReplies", () => {
  const { res, written } = fakeResponse(false);

  internalErrorHandler({ error: () => undefined, report: () => { throw new Error("salon injoignable"); } })(
    new Error("x"), {} as Request, res, () => undefined,
  );

  assert.deepEqual(written, { status: 500, json: { error: "INTERNAL_ERROR" }, destroyed: false });
});

/** Appelle une route enveloppée et rend ce qu'elle a passé à `next`. */
async function nextOf(handler: Parameters<typeof asyncRoute>[0]): Promise<unknown[]> {
  const calls: unknown[] = [];
  asyncRoute(handler)({} as Request, {} as Response, (error?: unknown) => { calls.push(error); });
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

test("asyncRoute_rejectedHandler_forwardsErrorToNext", async () => {
  const error = new Error("boom");

  assert.deepEqual(await nextOf(async () => { throw error; }), [error]);
});

test("asyncRoute_nullRejection_forwardsAnError", async () => {
  const calls = await nextOf(() => Promise.reject(null)); // NOSONAR : rejet sans valeur, le cas éprouvé

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_synchronousThrow_forwardsError", async () => {
  const error = new Error("sync");

  assert.deepEqual(await nextOf(() => { throw error; }), [error]);
});

test("asyncRoute_resolvedHandler_doesNotCallNext", async () => {
  assert.deepEqual(await nextOf(async () => undefined), []);
});

test("asyncRoute_zeroRejection_forwardsAnError", async () => {
  const calls = await nextOf(() => Promise.reject(0)); // NOSONAR : rejet falsy, le cas éprouvé

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_emptyStringRejection_forwardsAnError", async () => {
  const calls = await nextOf(() => Promise.reject("")); // NOSONAR : rejet falsy, le cas éprouvé

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_falseRejection_forwardsAnError", async () => {
  const calls = await nextOf(() => Promise.reject(false)); // NOSONAR : rejet falsy, le cas éprouvé

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_routeStringRejection_forwardsAnError", async () => {
  // `next("route")` passerait à la route suivante au lieu du gestionnaire d'erreur.
  const calls = await nextOf(() => Promise.reject("route")); // NOSONAR : chaîne spéciale d'Express

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_routerStringRejection_forwardsAnError", async () => {
  const calls = await nextOf(() => Promise.reject("router")); // NOSONAR : chaîne spéciale d'Express

  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test("asyncRoute_truthyNonErrorRejection_forwardsItUnchanged", async () => {
  const rejection = { code: 1 };

  assert.deepEqual(await nextOf(() => Promise.reject(rejection)), [rejection]); // NOSONAR : rejet non-Error, le cas éprouvé
});

test("internalErrorHandler_responseAlreadyEnded_neitherDestroysNorWritesButLogsAndReports", () => {
  const lines: string[] = [];
  const reports: string[] = [];
  const { res, written } = fakeResponse(true, true);

  internalErrorHandler({ error: (line) => lines.push(line), report: (line) => reports.push(line) })(
    new Error("x"), {} as Request, res, () => undefined,
  );

  // Réponse déjà partie en entier : la couper la ferait perdre au site.
  assert.deepEqual(written, { status: 0, json: undefined, destroyed: false });
  assert.deepEqual(lines, ["[internalApi] INTERNAL_ERROR (Error, code inconnu)"]);
  assert.deepEqual(reports, ["[internalApi] INTERNAL_ERROR (Error, code inconnu)"]);
});

test("unwrappedRoutes_everyHandlerWrapped_returnsEmpty", () => {
  const app = express();
  app.get("/a", asyncRoute(async () => undefined));
  app.post("/b", asyncRoute(() => undefined));

  assert.deepEqual(unwrappedRoutes(app), []);
});

test("unwrappedRoutes_plainAsyncHandler_listsMethodAndPath", () => {
  const app = express();
  app.get("/a", asyncRoute(async () => undefined));
  app.post("/b", async () => undefined);

  assert.deepEqual(unwrappedRoutes(app), ["POST /b"]);
});

test("unwrappedRoutes_middlewareOnly_returnsEmpty", () => {
  const app = express();
  app.use((_req, _res, next) => { next(); });

  assert.deepEqual(unwrappedRoutes(app), []);
});

test("unwrappedRoutes_syncMiddlewareBeforeWrappedHandler_returnsEmpty", () => {
  const app = express();
  app.post("/a", express.json({ limit: "1kb" }), asyncRoute(async () => undefined));

  assert.deepEqual(unwrappedRoutes(app), []);
});

test("unwrappedRoutes_bareAsyncMiddleware_listsTheRoute", () => {
  const app = express();
  app.post("/a", async (_req, _res, next) => { next(); }, asyncRoute(async () => undefined));

  assert.deepEqual(unwrappedRoutes(app), ["POST /a"]);
});

test("unwrappedRoutes_plainHandlerOnMountedRouter_listsIt", () => {
  const app = express();
  const router = express.Router();
  router.get("/b", async () => undefined);
  app.use("/internal/x", router);

  assert.deepEqual(unwrappedRoutes(app), ["GET /b"]);
});

test("unwrappedRoutes_noRouterStack_returnsNotFoundMarker", () => {
  // Pile absente (autre version d'Express) : jamais une liste vide qui ferait croire tout enveloppé.
  assert.deepEqual(unwrappedRoutes({} as Parameters<typeof unwrappedRoutes>[0]), [ROUTER_STACK_NOT_FOUND]);
});

test("wrapUnwrappedRoutes_noRouterStack_returnsNotFoundMarker", () => {
  assert.deepEqual(wrapUnwrappedRoutes({} as Parameters<typeof wrapUnwrappedRoutes>[0]), [ROUTER_STACK_NOT_FOUND]);
});

/** Démarre `app` sur un port libre, appelle `route`, rend le statut et le corps, puis ferme. */
async function callOnce(app: ReturnType<typeof express>, route: string): Promise<{ status: number; body: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(5_000) });
    return { status: response.status, body: await response.text() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("wrapUnwrappedRoutes_rejectingPlainRoute_answers500AndListsIt", async () => {
  const app = express();
  app.get("/a", async () => { throw new Error("secret"); });
  app.use(internalErrorHandler({ error: () => undefined }));

  const wrapped = wrapUnwrappedRoutes(app);
  const { status, body } = await callOnce(app, "/a");

  assert.deepEqual(wrapped, ["GET /a"]);
  assert.equal(status, 500);
  assert.deepEqual(JSON.parse(body), { error: "INTERNAL_ERROR" });
  assert.deepEqual(unwrappedRoutes(app), []);
});

test("wrapUnwrappedRoutes_wrappedAsyncMiddleware_stillCallsNext", async () => {
  const app = express();
  app.get("/a", async (_req, _res, next) => { next(); }, asyncRoute((_req, res) => { res.json({ ok: true }); }));

  const wrapped = wrapUnwrappedRoutes(app);
  const { status, body } = await callOnce(app, "/a");

  assert.deepEqual(wrapped, ["GET /a"]);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
});

test("wrapUnwrappedRoutes_everyRouteWrapped_changesNothing", () => {
  const app = express();
  app.get("/a", asyncRoute(async () => undefined));

  assert.deepEqual(wrapUnwrappedRoutes(app), []);
});
