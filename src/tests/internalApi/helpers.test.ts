import test from "node:test";
import assert from "node:assert/strict";
import {
  absDelta,
  deterministicColor,
  isLoopbackHost,
  matchesToken,
  relayStatus,
  sparklineFromBuckets,
  SPARKLINE_POINTS,
  internalErrorCode,
  internalErrorStatus,
} from "../../internalApi/helpers.js";

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

test("internalErrorCode_parseFailed_returnsInvalidJson", () => {
  assert.equal(internalErrorCode({ type: "entity.parse.failed" }), "INVALID_JSON");
});

test("internalErrorCode_tooLarge_returnsPayloadTooLarge", () => {
  assert.equal(internalErrorCode({ type: "entity.too.large" }), "PAYLOAD_TOO_LARGE");
});

test("internalErrorCode_otherError_returnsInternalError", () => {
  assert.equal(internalErrorCode(new Error("x")), "INTERNAL_ERROR");
  assert.equal(internalErrorCode(null), "INTERNAL_ERROR");
});

test("internalErrorCode_unsupportedEncoding_returnsUnsupportedEncoding", () => {
  assert.equal(internalErrorCode({ type: "encoding.unsupported" }), "UNSUPPORTED_ENCODING");
  assert.equal(internalErrorCode({ type: "charset.unsupported" }), "UNSUPPORTED_ENCODING");
});

test("internalErrorCode_requestAborted_returnsRequestAborted", () => {
  assert.equal(internalErrorCode({ type: "request.aborted" }), "REQUEST_ABORTED");
});

test("internalErrorCode_inheritedType_returnsInternalError", () => {
  assert.equal(internalErrorCode({ type: "toString" }), "INTERNAL_ERROR");
});

test("internalErrorStatus_bodyParserRefusal_returnsItsStatus", () => {
  assert.equal(internalErrorStatus({ type: "entity.parse.failed", status: 400 }), 400);
  assert.equal(internalErrorStatus({ type: "entity.too.large", status: 413 }), 413);
  assert.equal(internalErrorStatus({ type: "encoding.unsupported", status: 415 }), 415);
  assert.equal(internalErrorStatus({ type: "charset.unsupported", status: 415 }), 415);
  assert.equal(internalErrorStatus({ type: "request.aborted", status: 400 }), 400);
});

test("internalErrorStatus_foreignErrorWith4xxStatus_returns500", () => {
  // Une erreur Discord (« Unknown Channel ») porte un `status` 404 : jamais repris.
  assert.equal(internalErrorStatus({ status: 404, code: 10003 }), 500);
  assert.equal(internalErrorCode({ status: 404, code: 10003 }), "INTERNAL_ERROR");
});

test("internalErrorStatus_serverOrMissingStatus_returns500", () => {
  assert.equal(internalErrorStatus({ status: 503 }), 500);
  assert.equal(internalErrorStatus({ type: "entity.verify.failed", status: 403 }), 500);
  assert.equal(internalErrorStatus(new Error("x")), 500);
  assert.equal(internalErrorStatus({ status: "abc" }), 500);
});
