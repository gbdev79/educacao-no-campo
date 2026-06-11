process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ordm;/gi, "º")
    .replace(/&ordf;/gi, "ª")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&otilde;/gi, "õ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú");
}

function repairMojibake(value) {
  const textValue = String(value ?? "");

  if (!/[ÃÂ]/.test(textValue)) {
    return textValue;
  }

  try {
    return Buffer.from(textValue, "latin1").toString("utf8");
  } catch {
    return textValue;
  }
}

function cleanText(value) {
  return repairMojibake(decodeHtmlEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ));
}

function normalizeLookupText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseIconBooleanCell(cellHtml) {
  const rawHtml = String(cellHtml ?? "");

  if (!/fi-check/i.test(rawHtml)) {
    return "";
  }

  return /\bdiscreet\b/i.test(rawHtml) ? "Não" : "Sim";
}

function parseCellValue(cellHtml) {
  const textValue = cleanText(cellHtml);

  if (textValue) {
    return textValue;
  }

  return parseIconBooleanCell(cellHtml);
}

function extractTableByHeading(html, heading) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(match => match[0]);
  const normalizedHeading = normalizeLookupText(heading);

  return tables.find(tableHtml => {
    const tableHeading = tableHtml.match(/<h5>\s*([\s\S]*?)\s*<\/h5>/i)?.[1] ?? "";
    return normalizeLookupText(tableHeading) === normalizedHeading;
  }) ?? "";
}

function parseTableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => {
    const cells = [...match[0].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map(cellMatch => parseCellValue(cellMatch[2]))
      .filter(Boolean);

    return cells;
  }).filter(cells => cells.length > 0);
}

function getRowValue(rows, label) {
  const normalizedLabel = normalizeLookupText(label);
  const row = rows.find(cells => normalizeLookupText(cells[0]) === normalizedLabel);

  if (!row || row.length < 2) {
    return "";
  }

  return row[row.length - 1];
}

function hasRow(rows, label) {
  const normalizedLabel = normalizeLookupText(label);
  return rows.some(cells => cells.some(cell => normalizeLookupText(cell) === normalizedLabel));
}

function buildSectionRows(rows, {
  sectionTitle = "",
  excludeLabels = [],
  defaultSingleValue = "Sim",
  allowedValues = null
} = {}) {
  const ignoredLabels = new Set(
    [sectionTitle, ...excludeLabels]
      .map(label => cleanText(label))
      .filter(Boolean)
  );
  const seen = new Set();

  return rows.flatMap(cells => {
    const label = cleanText(cells[0]);

    if (!label || ignoredLabels.has(label) || /^Fonte:/i.test(label)) {
      return [];
    }

    const value = cleanText(cells.length > 1 ? cells[cells.length - 1] : defaultSingleValue);

    if (!value || value === label) {
      return [];
    }

    if (Array.isArray(allowedValues) && allowedValues.length > 0 && !allowedValues.includes(value)) {
      return [];
    }

    const dedupeKey = `${label}::${value}`;

    if (seen.has(dedupeKey)) {
      return [];
    }

    seen.add(dedupeKey);
    return [{ label, value }];
  });
}

function buildEnrollmentRows(rows) {
  const seen = new Set();

  return rows.flatMap(cells => {
    const label = cleanText(cells[0]);
    const value = cleanText(cells[cells.length - 1]);

    if (
      !label ||
      !value ||
      value === label ||
      /^Fonte:/i.test(label) ||
      !normalizeLookupText(value).includes("matricula")
    ) {
      return [];
    }

    const dedupeKey = `${label}::${value}`;

    if (seen.has(dedupeKey)) {
      return [];
    }

    seen.add(dedupeKey);
    return [{ label, value }];
  });
}

function toCount(value) {
  const match = String(value ?? "").match(/\d[\d.]*/);
  return match ? Number(match[0].replace(/\./g, "")) : null;
}

function toBoolean(value) {
  const normalizedValue = cleanText(value).toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  if (
    normalizedValue === "sim" ||
    normalizedValue.startsWith("sim ") ||
    normalizedValue.includes(" wireless") ||
    normalizedValue.includes(" a cabo")
  ) {
    return true;
  }

  if (
    normalizedValue === "não" ||
    normalizedValue.startsWith("não ") ||
    normalizedValue.includes("nenhum") ||
    normalizedValue.includes("nenhuma")
  ) {
    return false;
  }

  return null;
}

function pickBoolean(rows, label, { presenceMeansTrue = false } = {}) {
  const rowValue = getRowValue(rows, label);

  if (rowValue) {
    return toBoolean(rowValue);
  }

  if (presenceMeansTrue && hasRow(rows, label)) {
    return true;
  }

  return null;
}

function buildSchoolUrl(inepCode) {
  return `https://culturaeduca.cc/equipamento/escola_detalhe/${inepCode}/`;
}

function extractSchoolEnrichment(html, inepCode) {
  const enrollmentTitle = "Matriculas";
  const communityTitle = "Relacao escola-comunidade";
  const facilitiesTitle = "Infraestrutura (Dependencias)";
  const digitalTitle = "Internet, Computadores e Equipamentos Multimidia";
  const staffTitle = "Profissionais que atuam na escola";
  const studentTitle = "Alunos";
  const transportLabel = "Utiliza transporte escolar publico";
  const totalStudentsLabel = "Total de Alunos";
  const enrollmentRows = parseTableRows(extractTableByHeading(html, enrollmentTitle));
  const enrollments = buildEnrollmentRows(enrollmentRows);
  const communityRows = parseTableRows(extractTableByHeading(html, communityTitle));
  const facilitiesRows = parseTableRows(extractTableByHeading(html, facilitiesTitle));
  const digitalRows = parseTableRows(extractTableByHeading(html, digitalTitle));
  const staffRows = parseTableRows(extractTableByHeading(html, staffTitle));
  const studentRows = parseTableRows(extractTableByHeading(html, studentTitle));
  const sections = [
    {
      id: "enrollments",
      title: "Matrículas por etapa",
      rows: enrollments
    },
    {
      id: "digital",
      title: "Internet, computadores e equipamentos multimídia",
      rows: buildSectionRows(digitalRows, {
        sectionTitle: digitalTitle
      })
    },
    {
      id: "facilities",
      title: "Infraestrutura e dependências",
      rows: buildSectionRows(facilitiesRows, {
        sectionTitle: facilitiesTitle,
        defaultSingleValue: "",
        allowedValues: ["Sim", "Não"]
      })
    },
    {
      id: "staff",
      title: "Profissionais que atuam na escola",
      rows: buildSectionRows(staffRows, {
        sectionTitle: staffTitle
      })
    },
    {
      id: "community",
      title: "Relação escola-comunidade",
      rows: buildSectionRows(communityRows, {
        sectionTitle: communityTitle,
        defaultSingleValue: "",
        allowedValues: ["Sim", "Não"]
      })
    },
    {
      id: "students",
      title: "Alunos",
      rows: buildSectionRows(studentRows, {
        sectionTitle: studentTitle,
        excludeLabels: [transportLabel, totalStudentsLabel]
      })
    }
  ].filter(section => section.rows.length > 0);

  return {
    source: {
      label: "Cultura Educa • Censo Escolar da Educação Básica 2020",
      url: buildSchoolUrl(inepCode)
    },
    syncedAt: new Date().toISOString(),
    enrollments,
    overview: {
      studentsTotal: toCount(getRowValue(studentRows, totalStudentsLabel)),
      weekendOpen: pickBoolean(communityRows, "Abre no fim de semana"),
      pppUpdated: pickBoolean(
        communityRows,
        "Projeto político pedagógico atualizado nos últimos 12 meses (até a data de referência)"
      ),
      communitySpaceSharing: pickBoolean(
        communityRows,
        "A escola compartilha espaços para atividades de integração escola-comunidade"
      ),
      surroundingEquipmentUse: pickBoolean(
        communityRows,
        "A escola usa espaços e equipamentos do entorno escolar para atividades regulares com os alunos"
      )
    },
    digital: {
      internet: pickBoolean(digitalRows, "Internet", { presenceMeansTrue: true }),
      broadband: pickBoolean(digitalRows, "Banda Larga", { presenceMeansTrue: true }),
      localNetwork: getRowValue(digitalRows, "Rede local de interligação de computadores") || "",
      studentInternet: pickBoolean(digitalRows, "Acesso à Internet - Para uso dos alunos", { presenceMeansTrue: true }),
      administrativeInternet: pickBoolean(digitalRows, "Acesso à Internet - Para uso administrativo", { presenceMeansTrue: true }),
      teachingInternet: pickBoolean(digitalRows, "Acesso à Internet - Para uso nos processos de ensino e aprendizagem", { presenceMeansTrue: true }),
      communityInternet: pickBoolean(digitalRows, "Acesso à Internet - Para uso da comunidade", { presenceMeansTrue: true }),
      desktopCount: toCount(getRowValue(digitalRows, "Quantidade de computadores em uso pelos alunos (as) - Computador de mesa (desktop)")),
      laptopCount: toCount(getRowValue(digitalRows, "Quantidade de computadores em uso pelos alunos (as) - Computador portátil")),
      tabletCount: toCount(getRowValue(digitalRows, "Quantidade de computadores em uso pelos alunos (as) - Tablet")),
      projectorCount: toCount(getRowValue(digitalRows, "Projetor Multimídia (Datashow)")),
      digitalBoardCount: toCount(getRowValue(digitalRows, "Lousa Digital"))
    },
    facilities: {
      library: hasRow(facilitiesRows, "Biblioteca"),
      libraryOrReadingRoom: hasRow(facilitiesRows, "Biblioteca e/ou Sala de Leitura"),
      computerLab: hasRow(facilitiesRows, "Laboratório de Informática"),
      scienceLab: hasRow(facilitiesRows, "Laboratório de Ciências"),
      coveredCourt: hasRow(facilitiesRows, "Quadra de esportes coberta"),
      teachersRoom: hasRow(facilitiesRows, "Sala para os professores"),
      specialAttendanceRoom: hasRow(facilitiesRows, "Sala de atendimento especial"),
      kitchen: hasRow(facilitiesRows, "Cozinha")
    },
    staff: {
      pedagogicalSupport: toCount(getRowValue(
        staffRows,
        "Profissionais de apoio e supervisão pedagógica: pedagogo(a), coordenador(a) pedagógico(a), orientador(a) educacional, supervisor(a) escolar e coordenador(a) de área de ensino"
      )),
      secretary: toCount(getRowValue(staffRows, "Secretário(a) escolar")),
      generalServices: toCount(getRowValue(
        staffRows,
        "Auxiliar de serviços gerais, porteiro(a), zelador(a), faxineiro(a), horticultor(a), jardineiro(a)"
      )),
      kitchen: toCount(getRowValue(
        staffRows,
        "Profissionais de preparação e segurança alimentar, cozinheiro(a), merendeira e auxiliar de cozinha"
      )),
      labSupport: toCount(getRowValue(
        staffRows,
        "Técnicos(as), monitores(as), supervisores(as) ou auxiliares de laboratório(s), de apoio a tecnologias educacionais ou em multimeios/multimídias eletrônico/digitais"
      ))
    },
    sections
  };
}

export default async function handler(req, res) {
  // Extract inepCode from query
  const inepCode = req.query.inepCode || req.query.inep;

  if (!inepCode) {
    return res.status(400).json({ error: "Missing inepCode parameter" });
  }

  const url = `https://culturaeduca.cc/equipamento/escola_detalhe/${inepCode}/`;

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });

    if (response.status === 404) {
      // Cache 404 on Vercel Edge CDN for 7 days
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=604800, stale-while-revalidate=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({
        inepCode,
        status: "not_found",
        message: "HTTP 404",
        checkedAt: new Date().toISOString(),
        source: {
          label: "Cultura Educa • Censo Escolar da Educação Básica 2020",
          url
        }
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const enrichmentData = extractSchoolEnrichment(html, inepCode);

    // Cache success on Vercel Edge CDN for 7 days
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json(enrichmentData);
  } catch (error) {
    console.error("Enrichment error:", error);
    // Don't cache error statuses too long (1 min)
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      inepCode,
      status: "error",
      message: error.message || "Erro desconhecido",
      checkedAt: new Date().toISOString(),
      source: {
        label: "Cultura Educa • Censo Escolar da Educação Básica 2020",
        url
      }
    });
  }
}
