const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { pool, findOrCreateAula, findOrCreateInstructor, findOrCreateMunicipio } = require('../db');
const { getHolidayLabel } = require('../lib/holidays');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Utilidades de conversión para hojas de cálculo Excel
// - `xlDate` convierte valores de Excel o textos legibles a fecha ISO.
// - Se usa en varios parseadores para normalizar fechas de programación.
function xlDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isNaN(n) && String(v).trim().length && !String(v).includes(':')) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().split('T')[0];
  }
  const parsed = parseSpanishDate(String(v));
  return parsed;
}

function parseSpanishDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const monthMap = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  const match = text.match(/(\d{1,2})\s*de\s*([a-záéíóú]+)\s*de\s*(\d{4})/i);
  if (match) {
    const day = String(match[1]).padStart(2, '0');
    const month = monthMap[match[2].toLowerCase()] || '01';
    return `${match[3]}-${month}-${day}`;
  }
  const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmy) {
    let [_, day, month, year] = dmy;
    if (year.length === 2) year = '20' + year;
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const normalized = text.replace(/\./g, '-').replace(/\s+/, ' ');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function xlTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const total = v * 24;
    const h = Math.floor(total);
    const m = Math.round((total - h) * 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  const text = String(v).trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${String(match[1]).padStart(2,'0')}:${match[2]}`;
  const numeric = parseFloat(text.replace(',', '.'));
  if (!Number.isNaN(numeric)) {
    const hour = Math.floor(numeric);
    const minute = Math.round((numeric - hour) * 60);
    return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  }
  return null;
}

function parseDuration(v) {
  if (v === null || v === undefined || v === '') return null;
  const text = String(v).replace(',', '.').trim();
  const num = parseFloat(text);
  if (!Number.isNaN(num)) return num;
  const match = text.match(/(\d{1,2})(?:\s*h(?:oras?)?)?/i);
  if (match) return parseFloat(match[1]);
  return null;
}

function normalizeSituacion(v) {
  if (!v || String(v).trim().toLowerCase() === 'nan') return 'POR PROGRAMAR';
  const s = String(v).trim().toUpperCase();
  if (s.includes('NO PROGRAMADO')) return 'NO PROGRAMADO';
  if (s.includes('NO PROGRAMAR')) return 'NO PROGRAMAR';
  if (s.includes('PENDIENTE')) return 'PENDIENTE';
  if (s.includes('PROGRAMADO')) return 'PROGRAMADO';
  if (s.includes('PROGRAMAR')) return 'POR PROGRAMAR';
  return s || 'POR PROGRAMAR';
}

function normalizeHeaderCell(cell) {
  // Convierte un nombre de columna en un identificador de campo conocido.
  const text = String(cell || '').trim().toUpperCase();
  if (!text) return '';
  if (text.includes('FECHA')) return 'fecha';
  if (text.includes('PLACA') || text.includes('AULA')) return 'placa';
  if (text.includes('PROGRAMA')) return 'programa';
  if (text.includes('FICHA')) return 'ficha';
  if (text.includes('INSTRUCTOR')) return 'instructor';
  if (text.includes('HORA INICIO') || text.includes('INICIO')) return 'hora_ini';
  if (text.includes('HORA FIN') || text.includes('HORA FINAL')) return 'hora_fin';
  if (text.includes('HORAS') && !text.includes('TELEFONO')) return 'horas';
  if (text.includes('AMBIENTE') || text.includes('SEDE')) return 'ambiente';
  if (text.includes('MUNICIPIO')) return 'municipio';
  if (text.includes('CONDUCTOR')) return 'conductor';
  if (text.includes('SITUACION') || text.includes('SITUACIÓN') || text.includes('ESTADO')) return 'situacion';
  return '';
}

function findScheduleHeader(raw) {
  // Busca la fila de cabecera en el nuevo formato de programación.
  if (!raw || !raw.length) return -1;
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row) continue;
    const text = row.map(c => String(c || '').toUpperCase()).join(' ');
    const hasDate = text.includes('FECHA');
    const hasPrograma = text.includes('PROGRAMA');
    const hasInstructor = text.includes('INSTRUCTOR');
    const hasFicha = text.includes('FICHA');
    if (hasDate && hasPrograma && hasInstructor && (hasFicha || text.includes('HORARIO') || text.includes('AULA'))) {
      return i;
    }
  }
  return -1;
}

function parseScheduleRows(raw, headerIndex, defaults = {}) {
  // Convierte las filas de horario con cabecera conocida a objetos de sesión normalizados.
  const header = raw[headerIndex].map(normalizeHeaderCell);
  const indexMap = {};
  header.forEach((key, idx) => { if (key) indexMap[key] = idx; });
  const sessions = [];

  for (let i = headerIndex + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every(cell => cell === null || String(cell || '').trim() === '')) continue;
    const fecha = xlDate(row[indexMap.fecha]);
    if (!fecha) continue;

    let hora_ini = xlTime(row[indexMap.hora_ini]);
    let hora_fin = xlTime(row[indexMap.hora_fin]);
    if ((!hora_ini || !hora_fin) && indexMap.hora_ini != null) {
      const rawValue = String(row[indexMap.hora_ini] || '').trim();
      const parts = rawValue.split(/[-–—]/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        hora_ini = hora_ini || xlTime(parts[0]);
        hora_fin = hora_fin || xlTime(parts[1]);
      }
    }

    const session = {
      placa: parseCell(row[indexMap.placa]) || defaults.placa || '',
      ficha: parseCell(row[indexMap.ficha]) || defaults.ficha || '',
      programa: parseCell(row[indexMap.programa]) || defaults.programa || '',
      municipio: parseCell(row[indexMap.municipio]) || defaults.municipio || '',
      ambiente: parseCell(row[indexMap.ambiente]) || defaults.ambiente || '',
      instructor: parseCell(row[indexMap.instructor]) || defaults.instructor || '',
      conductor: parseCell(row[indexMap.conductor]) || defaults.conductor || '',
      situacion: normalizeSituacion(row[indexMap.situacion]),
      horas: parseDuration(row[indexMap.horas]),
      fecha,
      hora_ini,
      hora_fin,
      gastos: '',
      trim: '',
      nivel: '',
      codigo: '',
      version: '',
      aspirantes: null
    };

    sessions.push(session);
  }
  return sessions;
}

// Normaliza valores de celda a texto simple.
function parseCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Sanear objetos de aspirante antes de guardarlos como JSON.
function sanitizeAspirant(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return {
    nombre: String(obj.nombre || '').trim(),
    tipo_documento: String(obj.tipo_documento || '').trim(),
    documento: String(obj.documento || '').trim(),
    telefono: String(obj.telefono || '').trim(),
    poblacion: String(obj.poblacion || '').trim(),
    genero: String(obj.genero || '').trim()
  };
}

function hasAnyLabel(value, labels) {
  if (!value) return false;
  const text = String(value).toUpperCase();
  return labels.some(label => text.includes(label));
}

// Busca un valor asociado a una etiqueta en cualquier fila del libro.
function findLabel(raw, labels) {
  for (const row of raw) {
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (hasAnyLabel(row[c], labels)) {
        return parseCell(row[c + 1] || row[c + 2] || '');
      }
    }
  }
  return '';
}

// Lee una celda por fila y columna sin fallar si la fila no existe.
function getCell(raw, rowIndex, colIndex) {
  return raw && raw[rowIndex] && raw[rowIndex][colIndex] != null ? raw[rowIndex][colIndex] : null;
}

// Busca una etiqueta en una fila fija y devuelve el valor en la columna siguiente.
function findByFixedPosition(raw, label, rowIndex, labelCol = 0, valueCol) {
  const row = raw[rowIndex];
  if (!row) return null;
  const tryLabelCols = labelCol === 0 ? [0, 1] : [labelCol];
  for (const lc of tryLabelCols) {
    const cell = String(row[lc] || '');
    if (hasAnyLabel(cell, [label])) {
      valueCol = valueCol ?? lc + 1;
      return parseCell(row[valueCol] ?? row[lc + 2] ?? '');
    }
  }
  return null;
}

// Extrae una placa de aula móvil del texto libre si aparece en la celda.
function extractPlateFromText(text) {
  if (!text) return '';
  const match = String(text).toUpperCase().match(/OVE\d{2,3}|OJA\d{2,3}|\bAULA\s*\w+/i);
  return match ? match[0].replace(/^AULA\s*/i, '') : '';
}

// Busca la primera placa de aula móvil encontrada en todo el libro.
function findPlate(raw) {
  if (!raw) return '';
  for (const row of raw) {
    if (!row) continue;
    for (const cell of row) {
      const plate = extractPlateFromText(cell);
      if (plate) return plate;
    }
  }
  return '';
}

// Verifica si una fila contiene todas las palabras clave de una cabecera.
function rowContainsHeader(row, keywords) {
  if (!row) return false;
  const text = row.map(c => String(c||'').toUpperCase()).join(' ');
  return keywords.every(word => text.includes(word));
}

// Devuelve el índice de la fila que parece ser cabecera de una tabla.
function findHeaderRow(raw, keywords) {
  return raw.findIndex(row => row && rowContainsHeader(row, keywords));
}

const SPANISH_DAYS = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6
};

// Convierte un texto de días en una lista de índices de día de la semana.
function parseDaysOfWeek(value) {
  if (!value) return null;
  const text = String(value).toUpperCase().trim();
  if (!text) return null;
  const dayNames = Object.keys(SPANISH_DAYS);

  const rangeMatch = text.match(/(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)\s*(?:A|–|-)\s*(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)/i);
  if (rangeMatch) {
    const startDay = SPANISH_DAYS[rangeMatch[1].toLowerCase()];
    const endDay = SPANISH_DAYS[rangeMatch[2].toLowerCase()];
    if (startDay !== undefined && endDay !== undefined) {
      const days = [];
      if (endDay >= startDay) {
        for (let i = startDay; i <= endDay; i++) days.push(i);
      } else {
        for (let i = startDay; i <= 6; i++) days.push(i);
        for (let i = 0; i <= endDay; i++) days.push(i);
      }
      return days;
    }
  }

  const parts = text.split(/[Y,]+/).map(s => s.trim()).filter(Boolean);
  const days = [];
  for (const part of parts) {
    for (const [es, num] of Object.entries(SPANISH_DAYS)) {
      if (part.includes(es.toUpperCase())) {
        if (!days.includes(num)) days.push(num);
        break;
      }
    }
  }
  if (days.length > 0) return days.sort();

  for (const [es, num] of Object.entries(SPANISH_DAYS)) {
    if (text.includes(es.toUpperCase())) return [num];
  }

  return null;
}

// Genera sesiones repetidas entre dos fechas según los días de la semana seleccionados.
function generateSessionsInRange(template, fechaInicio, fechaFinal, diasSemana) {
  const sessions = [];
  const start = new Date(fechaInicio + 'T12:00:00');
  const end = new Date(fechaFinal + 'T12:00:00');
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (diasSemana.includes(dayOfWeek)) {
      const dateStr = current.toISOString().split('T')[0];
      if (!getHolidayLabel(dateStr)) {
        sessions.push({ ...template, fecha: dateStr });
      }
    }
    current.setDate(current.getDate() + 1);
  }
  return sessions;
}

// Detecta si el archivo corresponde al nuevo formato basado en etiquetas de aspirantes.
function detectNewFormat(raw) {
  return raw.some(row => row && row.some(cell => /APELLIDOS Y NOMBRES|TIPO DE DOCUMENTO|SOLICITUD DE MATRICULA/i.test(String(cell||''))));
}

// Comprueba si la hoja tiene columnas típicas de programacion como placa/fecha/programa.
function hasColumnStructure(raw) {
  return raw.some(row => row && row.some(cell => {
    const text = String(cell||'').toUpperCase();
    return text.includes('PLACA') || text.includes('FECHA') || text.includes('PROGRAMA');
  }));
}

// Parsea el formato nuevo de Excel donde los datos de programación pueden estar distribuidos en bloques fijos.
function parseNewFormat(raw) {
  const programa = findLabel(raw, ['PROGRAMA DE FORMACION', 'PROGRAMA']);
  const codigo = findByFixedPosition(raw, 'CODIGO', 2, 0) || findLabel(raw, ['CODIGO', 'CÓDIGO']);
  const version = findByFixedPosition(raw, 'VERSION', 3, 0) || findLabel(raw, ['VERSION', 'VERSIÓN']);
  const duracion = findByFixedPosition(raw, 'DURACION', 4, 0) || findLabel(raw, ['DURACION', 'DURACIÓN', 'DURACIÓN DEL DISEÑO CURRICULAR', 'DURACION DEL DISEÑO CURRICULAR']);
  const municipio = findByFixedPosition(raw, 'MUNICIPIO', 5, 0) || findLabel(raw, ['MUNICIPIO']);
  const ambiente = findByFixedPosition(raw, 'AMBIENTE', 6, 0) || findLabel(raw, ['AMBIENTE']);
  const ficha = findLabel(raw, ['FICHA']);
  const fechaInicio = xlDate(findByFixedPosition(raw, 'FECHA DE INICIO', 7, 0) || findLabel(raw, ['FECHA DE INICIO', 'FECHA INICIO', 'FECHA INICIAL', 'FECHA DE INICIO (DD-MM-AAAA)']));
  const fechaFinal = xlDate(findByFixedPosition(raw, 'FECHA DE FINALIZACION', 8, 0) || findLabel(raw, ['FECHA DE FINALIZACION', 'FECHA FINALIZACION', 'FECHA DE FINALIZACIÓN', 'FECHA FINALIZACIÓN']));
  const hora_ini = xlTime(findByFixedPosition(raw, 'HORA INICIAL', 10, 0) || findLabel(raw, ['HORA INICIAL', 'HORA INICIO', 'HORA INICIAL EN HORARIO MILITAR', 'HORA INICIO (HORA MILITAR)']));
  const hora_fin = xlTime(findByFixedPosition(raw, 'HORA FINAL', 11, 0) || findLabel(raw, ['HORA FINAL', 'HORA DE FINALIZACION', 'HORA FINAL EN HORARIO MILITAR', 'HORA FINALIZACION (HORA MILITAR)']));
  
  // Buscar placa en CARACTERIZACIÓN DEL PROGRAMA
  const caracterizacion = findLabel(raw, ['CARACTERIZACION DEL PROGRAMA', 'CARACTERIZACIÓN DEL PROGRAMA']);
  const defaultPlaca = extractPlateFromText(caracterizacion) || findLabel(raw, ['PLACA', 'AULA MOVIL', 'AULA']) || findPlate(raw);

  const instructor = findLabel(raw, ['INSTRUCTOR', 'INSTRUCTOR(ES)', 'INSTRUCTORES', 'NOMBRE DEL INSTRUCTOR', 'DOCENTE', 'FORMADOR']);
  const conductor = findLabel(raw, ['CONDUCTOR', 'NOMBRE DEL CONDUCTOR', 'CHOFER', 'RESPONSABLE', 'COORDINADOR']) || '';
  const conductorTelefono = findLabel(raw, ['TELEFONO CONDUCTOR', 'TELÉFONO CONDUCTOR', 'CELULAR CONDUCTOR']);
  const servicio = findLabel(raw, ['EMPRESA SOLICITANTE', 'EMPRESA SOLICITUD-CONVENIO', 'COORDINADOR ACADEMICO']);
  const diasText = findByFixedPosition(raw, 'DIA', 9, 0) || findLabel(raw, ['DIAS', 'DÍA', 'DIA', 'DIA DE LA SEMANA', 'DÍA DE LA SEMANA', 'HORARIO', 'JORNADA', 'DIA DE FORMACION', 'DIAS DE FORMACION', 'DÍAS DE FORMACIÓN']);
  const horas = parseDuration(duracion) || null;

  // Si el archivo tiene una tabla de horarios estructurada, parsear directamente esas filas.
  const headerIndex = findScheduleHeader(raw);
  if (headerIndex >= 0) {
    const structured = parseScheduleRows(raw, headerIndex, {
      programa,
      municipio,
      ambiente,
      ficha,
      instructor,
      conductor,
      placa: defaultPlaca
    });
    if (structured.length) {
      return structured;
    }
  }

  console.log('[DEBUG parseNewFormat]', JSON.stringify({
    programa, codigo, version, duracion, municipio, ambiente, ficha,
    fechaInicio, fechaFinal, hora_ini, hora_fin, instructor, placa: defaultPlaca, diasText
  }));

  // Recopila datos de aspirantes si existe un bloque de inscripción al final del archivo.
  const aspirantesHeaderIndex = findHeaderRow(raw, ['APELLIDOS Y NOMBRES', 'TIPO DE DOCUMENTO']);
  const aspirantes = [];
  if (aspirantesHeaderIndex >= 0) {
    const header = raw[aspirantesHeaderIndex].map(c => String(c||'').trim().toUpperCase());
    const idxNombre = header.findIndex(h => h.includes('APELLIDOS'));
    const idxTipo = header.findIndex(h => h.includes('TIPO DE DOCUMENTO'));
    const idxDocumento = header.findIndex(h => h.includes('NUMERO DE DOCUMENTO'));
    const idxTelefono = header.findIndex(h => h.includes('TELEFONO'));
    const idxPoblacion = header.findIndex(h => h.includes('TIPO DE POBLACION'));
    const idxGenero = header.findIndex(h => h.includes('GENERO'));
    for (let i = aspirantesHeaderIndex + 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row) continue;
      const nombre = parseCell(row[idxNombre]);
      if (!nombre) continue;
      aspirantes.push(sanitizeAspirant({
        nombre,
        tipo_documento: parseCell(row[idxTipo]),
        documento: parseCell(row[idxDocumento]),
        telefono: parseCell(row[idxTelefono]),
        poblacion: parseCell(row[idxPoblacion]),
        genero: parseCell(row[idxGenero])
      }));
    }
  }

  // Detecta faltantes informativos y establece el estado de la sesión.
  const missing = [];
  if (!placa) missing.push('Aula');
  if (!instructor) missing.push('Instructor');
  if (!ambiente) missing.push('Ambiente');
  if (!municipio) missing.push('Municipio');
  if (!ficha) missing.push('Ficha');
  if (!fechaInicio && !fechaFinal) missing.push('Fecha');
  if (!hora_ini) missing.push('Hora inicio');
  if (!hora_fin) missing.push('Hora fin');

  const situacion = missing.length ? 'PENDIENTE' : 'PROGRAMADO';
  const pendientesText = missing.length ? `Falta: ${missing.join(', ')}` : null;

  const baseSession = {
    nivel: '',
    ficha,
    programa,
    codigo,
    version,
    municipio,
    ambiente,
    instructor,
    hora_ini,
    hora_fin,
    horas,
    gastos: '',
    trim: '',
    placa: placa || '',
    conductor: conductor || '',
    conductor_telefono: conductorTelefono || null,
    situacion,
    pendientes: pendientesText,
    aspirantes: aspirantes.length > 0 ? aspirantes : null
  };

  const diasSemana = diasText ? parseDaysOfWeek(diasText) : null;
  if (fechaInicio && fechaFinal && diasSemana && diasSemana.length > 0) {
    return generateSessionsInRange(baseSession, fechaInicio, fechaFinal, diasSemana);
  }
  if (fechaInicio && fechaFinal) {
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    return generateSessionsInRange(baseSession, fechaInicio, fechaFinal, allDays);
  }

  const fecha = fechaInicio || fechaFinal;
  return [{ ...baseSession, fecha }];
}

// Parsea el formato antiguo de Excel donde cada fila representa una sesión completa.
function parseOldFormat(raw) {
  let headerRow = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && raw[i].some(c => {
      const text = String(c||'').toUpperCase();
      return text.includes('PLACA') || text.includes('AULA');
    })) { headerRow = i; break; }
  }
  if (headerRow === -1) return [];
  const headers = raw[headerRow].map(h => String(h||'').trim().toLowerCase());
  const idx = {
    nivel: headers.findIndex(h => h.includes('nivel')),
    ficha: headers.findIndex(h => h.includes('ficha')),
    programa: headers.findIndex(h => h.includes('programa')),
    codigo: headers.findIndex(h => h.includes('codigo') || h.includes('código')),
    version: headers.findIndex(h => h.includes('version') || h.includes('versión')),
    municipio: headers.findIndex(h => h.includes('municipio')),
    ambiente: headers.findIndex(h => h.includes('ambiente')),
    instructor: headers.findIndex(h => h.includes('instructor')),
    fecha: headers.findIndex(h => h.includes('fecha')),
    hora_ini: headers.findIndex(h => h.includes('inicial')),
    hora_fin: headers.findIndex(h => h.includes('final')),
    horas: headers.findIndex(h => h.includes('horas')),
    gastos: headers.findIndex(h => h.includes('gastos')),
    trim: headers.findIndex(h => h.includes('trim')),
    placa: headers.findIndex(h => h.includes('placa') || h.includes('aula')),
    conductor: headers.findIndex(h => h.includes('conductor')),
    telefono: headers.findIndex(h => h.includes('telefono') || h.includes('tel')),
    situacion: headers.findIndex(h => h.includes('situacion') || h.includes('situación')),
  };

  const sesiones = [];
  for (let i = headerRow + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[idx.fecha] || !row[idx.placa]) continue;
    const placa = String(row[idx.placa]||'').trim();
    if (!placa || placa === 'null') continue;
    const fecha = xlDate(row[idx.fecha]);
    if (!fecha) continue;
    const hora_ini = xlTime(row[idx.hora_ini]);
    const hora_fin = xlTime(row[idx.hora_fin]);
    const programaText = String(row[idx.programa]||'').trim();
    const pendientes = [];
    if (!programaText) pendientes.push('Programa');
    if (!String(row[idx.instructor]||'').trim()) pendientes.push('Instructor');
    if (!String(row[idx.ambiente]||'').trim()) pendientes.push('Ambiente');
    if (!String(row[idx.municipio]||'').trim()) pendientes.push('Municipio');

    sesiones.push({
      nivel: String(row[idx.nivel]||'').trim(),
      ficha: String(row[idx.ficha]||'').trim(),
      programa: String(row[idx.programa]||'').trim(),
      codigo: String(row[idx.codigo]||'').trim(),
      version: String(row[idx.version]||'').trim(),
      municipio: String(row[idx.municipio]||'').trim(),
      ambiente: String(row[idx.ambiente]||'').trim(),
      instructor: String(row[idx.instructor]||'').trim(),
      fecha,
      hora_ini,
      hora_fin,
      horas: parseFloat(row[idx.horas]) || null,
      gastos: String(row[idx.gastos]||'').trim(),
      trim: String(row[idx.trim]||'').trim(),
      placa,
      conductor: String(row[idx.conductor]||'').trim(),
      conductor_telefono: String(row[idx.telefono]||'').trim() || null,
      situacion: normalizeSituacion(row[idx.situacion]),
      pendientes: pendientes.length ? `Falta: ${pendientes.join(', ')}` : null,
      aspirantes: null
    });
  }
  return sesiones;
}

// Busca si ya existe una programacion idéntica en la base de datos.
async function findExistingProgramacion(s) {
  if (!s.placa || !s.fecha) return null;
  const { rows } = await pool.query(`
    SELECT p.id, a.placa, p.fecha_inicio AS fecha, p.hora_ini, p.programa
    FROM programaciones p
    JOIN aulas_moviles a ON p.aula_id = a.id
    WHERE LOWER(a.placa) = LOWER($1)
      AND p.fecha_inicio = $2
      AND LOWER(COALESCE(p.programa, '')) = LOWER(COALESCE($3, ''))
      AND COALESCE(p.hora_ini, '') = COALESCE($4, '')
    LIMIT 1`,
    [s.placa, s.fecha, s.programa || '', s.hora_ini || '']
  );
  return rows[0] || null;
}

// Manejador de importación de programación. Carga el archivo, detecta el formato,
// normaliza las sesiones y las inserta en la base de datos con protección de duplicados.
router.post('/programacion', upload.single('file'), async (req, res) => {
  try {
    // Leer archivo Excel y convertir la primera hoja a una matriz de filas.
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    console.log('[DEBUG] Raw (primeras 15 filas):', JSON.stringify(raw.slice(0, 15)));

    const isNewFormat = detectNewFormat(raw);
    console.log('[DEBUG] detectNewFormat:', isNewFormat);

    let sesiones;
    if (isNewFormat) {
      sesiones = parseNewFormat(raw);
      if (!sesiones.length || !sesiones.some(s => s.fecha)) {
        console.log('[DEBUG] New format produced no valid sessions, trying old format');
        sesiones = parseOldFormat(raw);
      }
    } else {
      sesiones = parseOldFormat(raw);
    }
    console.log('[DEBUG] Sesiones generadas:', sesiones.length, JSON.stringify(sesiones.map(s => ({ fecha: s.fecha, programa: s.programa, placa: s.placa }))));
    if (!sesiones.length) return res.status(400).json({ error: 'No se encontraron sesiones válidas' });

    // Asignar placa por defecto si se proporciona y falta en algunas sesiones
    const defaultPlaca = req.body?.placa || '';
    if (defaultPlaca) {
      sesiones.forEach(s => {
        if (!s.placa) {
          s.placa = defaultPlaca;
        }
      });
    }

    // Verificar duplicados (saltar si se envía confirmToken)
    const confirmToken = req.body?.confirmToken || '';
    let bypassDupCheck = false;
    if (confirmToken) {
      try {
        const decoded = JSON.parse(Buffer.from(confirmToken, 'base64').toString());
        bypassDupCheck = decoded.programa === sesiones[0].programa;
      } catch (_) {}
    }
    if (!bypassDupCheck) {
      const fechas = sesiones.filter(s => s.fecha).map(s => s.fecha);
      if (fechas.length > 0) {
        fechas.sort();
        const dupCheck = await pool.query(`
          SELECT COUNT(*)::int AS total
          FROM programaciones p
          LEFT JOIN aulas_moviles a ON p.aula_id = a.id
          WHERE p.programa = $1
            AND p.fecha_inicio >= $2
            AND p.fecha_inicio <= $3`,
          [sesiones[0].programa || '', fechas[0], fechas[fechas.length - 1]]
        );
        if (dupCheck.rows[0].total > 0) {
          return res.status(409).json({
            error: 'duplicado',
            message: `Ya existen ${dupCheck.rows[0].total} sesiones para "${sesiones[0].programa || 'Sin programa'}" en el rango ${fechas[0]} a ${fechas[fechas.length - 1]}. ¿Deseas continuar de todas formas?`,
            confirmToken: Buffer.from(JSON.stringify({ programa: sesiones[0].programa })).toString('base64'),
            existing: dupCheck.rows[0].total
          });
        }
      }
    }

    let inserted = 0;
    let skipped = 0;
    const pending = [];
    const pendingDetails = [];

    for (const s of sesiones) {
      if (!s.fecha) {
        pendingDetails.push({ programa: s.programa || 'Sin programa', placa: s.placa, fecha: 'N/A', pendientes: 'Sin fecha', instructor: s.instructor || '—' });
        continue;
      }
      if (getHolidayLabel(s.fecha)) {
        skipped++;
        continue;
      }

      const duplicateSession = await findExistingProgramacion(s);
      if (duplicateSession) {
        return res.status(409).json({
          error: 'duplicado',
          message: `Ya existe una sesión similar para placa ${s.placa} el ${s.fecha} con programa "${s.programa || 'Sin programa'}".`,
          existing: duplicateSession
        });
      }

      const aulaId = await findOrCreateAula(s.placa || defaultPlaca || 'SIN AULA', s.conductor, s.conductor_telefono);
      const instructorId = await findOrCreateInstructor(s.instructor);
      const municipioId = await findOrCreateMunicipio(s.municipio);
      const horario = s.hora_ini && s.hora_fin ? `${s.hora_ini} - ${s.hora_fin}` : null;

      console.log('[DEBUG] Insertando sesión:', { programa: s.programa, placa: s.placa, aspirantes: s.aspirantes });
      const insertQuery = `
        INSERT INTO programaciones (
          aula_id, instructor_id, municipio_id, ficha, programa,
          fecha_inicio, fecha_fin, horario, hora_ini, hora_fin, horas,
          ambiente, conductor, situacion, trim, nivel, codigo, version,
          gastos, pendientes, aspirantes
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
        )`;
      const insertParams = [
        aulaId,
        instructorId,
        municipioId,
        s.ficha || null,
        s.programa || null,
        s.fecha,
        s.fecha,
        horario,
        s.hora_ini || null,
        s.hora_fin || null,
        s.horas || null,
        s.ambiente || null,
        s.conductor || null,
        s.situacion || 'PENDIENTE',
        s.trim || null,
        s.nivel || null,
        s.codigo || null,
        s.version || null,
        s.gastos || null,
        s.pendientes || null,
        s.aspirantes || null
      ];
      try {
        await pool.query(insertQuery, insertParams);
      } catch (err) {
        console.error('[UPLOAD ERROR] programaciones insert failed', {
          error: err.message,
          query: insertQuery,
          paramsCount: insertParams.length,
          paramsPreview: insertParams.map(p => (p && typeof p === 'object' ? '[object]' : p))
        });
        throw err;
      }
      inserted++;
      if (s.pendientes) {
        pending.push(`${s.programa || 'Sesión'} ${s.fecha}: ${s.pendientes}`);
        pendingDetails.push({
          programa: s.programa || 'Sin programa',
          placa: s.placa || defaultPlaca || '—',
          fecha: s.fecha,
          pendientes: s.pendientes || 'Datos incompletos',
          instructor: s.instructor || '—'
        });
      }
    }

    res.json({ ok: true, inserted, skipped, total: sesiones.length, pending, pendingDetails });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
