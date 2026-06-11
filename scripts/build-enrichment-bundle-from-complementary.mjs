import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const INPUT_FILE = path.join(projectRoot, "dados-complementares.json");
const OUTPUT_DIR = path.join(projectRoot, "school-enrichment-bundle");
const MANIFEST_FILE = path.join(OUTPUT_DIR, "manifest.json");
const SHARD_SIZE = 200;

function isGitLfsPointer(value) {
  return String(value ?? "").trimStart().startsWith("version https://git-lfs.github.com/spec/v1");
}

async function clearPreviousBundle() {
  await fsPromises.mkdir(OUTPUT_DIR, { recursive: true });
  const entries = await fsPromises.readdir(OUTPUT_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "manifest.json" || /^shard-\d{4}\.json$/i.test(entry.name)) {
      await fsPromises.unlink(path.join(OUTPUT_DIR, entry.name));
    }
  }
}

async function writeShard(shardId, payload, count) {
  const shardName = `shard-${String(shardId).padStart(4, "0")}.json`;
  await fsPromises.writeFile(
    path.join(OUTPUT_DIR, shardName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );

  if (shardId === 1 || shardId % 25 === 0) {
    console.log(`[${shardId}] ${shardName} gerado com ${count} escola(s).`);
  }
}

async function main() {
  await clearPreviousBundle();

  const fileHandle = await fsPromises.open(INPUT_FILE, "r");
  const firstChunkBuffer = Buffer.alloc(120);
  const firstRead = await fileHandle.read(firstChunkBuffer, 0, firstChunkBuffer.length, 0);
  await fileHandle.close();
  const firstBytes = firstChunkBuffer.subarray(0, firstRead.bytesRead).toString("utf8");

  if (isGitLfsPointer(firstBytes)) {
    throw new Error("dados-complementares.json ainda está como ponteiro Git LFS.");
  }

  const input = fs.createReadStream(INPUT_FILE, { encoding: "utf8" });
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "dados-complementares.json",
    shardSize: SHARD_SIZE,
    totalEntries: 0,
    totalShards: 0,
    entries: {}
  };
  let buffer = "";
  let insideSchoolsArray = false;
  let insideObject = false;
  let insideString = false;
  let escapeNext = false;
  let objectDepth = 0;
  let objectBuffer = "";
  let shardId = 1;
  let shardPayload = {};
  let shardCount = 0;

  async function consumeEntry(entry) {
    const inepCode = String(entry?.inepCode ?? "").trim();
    const complementaryData = entry?.complementaryData;

    if (!inepCode || !complementaryData || typeof complementaryData !== "object") {
      return;
    }

    shardPayload[inepCode] = complementaryData;
    manifest.entries[inepCode] = shardId;
    manifest.totalEntries += 1;
    shardCount += 1;

    if (shardCount >= SHARD_SIZE) {
      await writeShard(shardId, shardPayload, shardCount);
      manifest.totalShards = shardId;
      shardId += 1;
      shardPayload = {};
      shardCount = 0;
    }
  }

  for await (const chunk of input) {
    buffer += chunk;

    if (!insideSchoolsArray) {
      const markerIndex = buffer.indexOf('"schools"');

      if (markerIndex === -1) {
        buffer = buffer.slice(Math.max(0, buffer.length - 20));
        continue;
      }

      const arrayStartIndex = buffer.indexOf("[", markerIndex);

      if (arrayStartIndex === -1) {
        buffer = buffer.slice(markerIndex);
        continue;
      }

      buffer = buffer.slice(arrayStartIndex + 1);
      insideSchoolsArray = true;
    }

    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];

      if (!insideObject) {
        if (character === "{") {
          insideObject = true;
          objectDepth = 1;
          objectBuffer = "{";
        }
        continue;
      }

      objectBuffer += character;

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (character === "\\") {
        escapeNext = true;
        continue;
      }

      if (character === "\"") {
        insideString = !insideString;
        continue;
      }

      if (insideString) {
        continue;
      }

      if (character === "{") {
        objectDepth += 1;
      } else if (character === "}") {
        objectDepth -= 1;

        if (objectDepth === 0) {
          await consumeEntry(JSON.parse(objectBuffer));
          insideObject = false;
          objectBuffer = "";
        }
      }
    }

    buffer = "";
  }

  if (shardCount > 0) {
    await writeShard(shardId, shardPayload, shardCount);
    manifest.totalShards = shardId;
  }

  await fsPromises.writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Manifesto gerado em ${MANIFEST_FILE}`);
  console.log(`${manifest.totalEntries.toLocaleString("pt-BR")} escola(s) adicionadas ao bundle.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
