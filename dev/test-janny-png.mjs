// Dev-only: build a PNG with a tEXt/chara chunk and verify the JannyAI parser.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { readCardFromPng } from "../src/janny.js";
import { toSillyTavernCard } from "../src/host.js";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

const card = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Test Janny Card",
    description: "desc",
    personality: "personality",
    first_mes: "hello",
  },
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.from([0, 255, 0, 0, 255]);
const text = Buffer.concat([
  Buffer.from("chara", "latin1"),
  Buffer.from([0]),
  Buffer.from(Buffer.from(JSON.stringify(card)).toString("base64"), "latin1"),
]);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("tEXt", text),
  chunk("IEND", Buffer.alloc(0)),
]);

const parsed = await readCardFromPng({
  arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
});
const stCard = toSillyTavernCard(parsed, {
  jannyai: { id: 'test-id', source: 'jannyai' },
});
writeFileSync(new URL("./test-janny-card.png", import.meta.url), png);
console.log(
  JSON.stringify(
    {
      name: parsed?.data?.name,
      spec: parsed?.spec,
      jannyai: stCard?.data?.extensions?.jannyai,
    },
    null,
    2,
  ),
);
if (parsed?.data?.name !== "Test Janny Card") process.exit(1);
if (stCard?.data?.extensions?.jannyai?.id !== "test-id") process.exit(1);
