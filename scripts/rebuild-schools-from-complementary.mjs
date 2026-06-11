import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";

const projectRoot = process.cwd();
const INPUT_FILE = path.join(projectRoot, "dados-complementares.json");
const OUTPUT_FILE = path.join(projectRoot, "escolas-rurais.json");
const POINTER_BACKUP_FILE = path.join(projectRoot, "escolas-rurais.lfs-pointer.txt");

function isGitLfsPointer(value) {
  return String(value ?? "").trimStart().startsWith("version https://git-lfs.github.com/spec/v1");
}

function createSchoolRow(entry) {
  const complementaryData = entry?.complementaryData ?? {};
  const sections = Array.isArray(complementaryData?.sections) ? complementaryData.sections : [];
  const enrollmentRows = Array.isArray(complementaryData?.enrollments) ? complementaryData.enrollments : [];
  const stageLabels = enrollmentRows
    .map(item => String(item?.label ?? "").trim())
    .filter(Boolean);
  const studentSection = sections.find(section => section?.id === "students");
  const studentsTotal = complementaryData?.overview?.studentsTotal;

  return {
    "Restrição de Atendimento": "Não informado",
    "Escola": String(entry?.schoolName ?? "").trim(),
    "Código INEP": String(entry?.inepCode ?? "").trim(),
    "UF": String(entry?.uf ?? "").trim(),
    "Município": String(entry?.city ?? "").trim(),
    "Localidade Diferenciada": "Não informado",
    "Endereço": "",
    "Telefone": "",
    "Dependência Administrativa": "Não informado",
    "Regulamentação pelo Conselho de Educação": "Não informado",
    "Porte da Escola": typeof studentsTotal === "number"
      ? `${studentsTotal.toLocaleString("pt-BR")} aluno(s) registrados no Cultura Educa`
      : "Não informado",
    "Etapas e Modalidade de Ensino Oferecidas": stageLabels.join(", "),
    "Outras Modalidades": Array.isArray(studentSection?.rows)
      ? studentSection.rows.map(row => `${row?.label ?? ""}: ${row?.value ?? ""}`.trim()).filter(Boolean).join("; ")
      : "",
    "Latitude": "",
    "Longitude": ""
  };
}

function createSchoolsArrayExtractor(onEntry) {
  let buffer = "";
  let insideSchoolsArray = false;
  let insideObject = false;
  let insideString = false;
  let escapeNext = false;
  let objectDepth = 0;
  let objectBuffer = "";

  return new Transform({
    decodeStrings: false,
    transform(chunk, encoding, callback) {
      buffer += chunk;

      if (!insideSchoolsArray) {
        const markerIndex = buffer.indexOf('"schools"');

        if (markerIndex === -1) {
          buffer = buffer.slice(Math.max(0, buffer.length - 20));
          callback();
          return;
        }

        const arrayStartIndex = buffer.indexOf("[", markerIndex);

        if (arrayStartIndex === -1) {
          buffer = buffer.slice(markerIndex);
          callback();
          return;
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
            onEntry(JSON.parse(objectBuffer));
            insideObject = false;
            objectBuffer = "";
          }
        }
      }

      buffer = "";

      callback();
    }
  });
}

async function main() {
  const currentOutput = await fsPromises.readFile(OUTPUT_FILE, "utf8").catch(() => "");

  if (isGitLfsPointer(currentOutput)) {
    await fsPromises.writeFile(POINTER_BACKUP_FILE, currentOutput, "utf8");
  }

  const out = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8" });
  let count = 0;

  out.write("[\n");

  const extractor = createSchoolsArrayExtractor(entry => {
    const row = createSchoolRow(entry);

    if (!row["Código INEP"] || !row["Escola"]) {
      return;
    }

    out.write(`${count > 0 ? ",\n" : ""}${JSON.stringify(row, null, 2)}`);
    count += 1;
  });

  await new Promise((resolve, reject) => {
    fs.createReadStream(INPUT_FILE, { encoding: "utf8" })
      .pipe(extractor)
      .on("finish", resolve)
      .on("error", reject);
  });

  out.write("\n]\n");

  await new Promise((resolve, reject) => {
    out.end(error => {
      if (error) reject(error);
      else resolve();
    });
  });

  console.log(`Base reconstruída em ${OUTPUT_FILE}`);
  console.log(`${count.toLocaleString("pt-BR")} escola(s) exportadas.`);
  console.log(`Ponteiro LFS anterior preservado em ${POINTER_BACKUP_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
