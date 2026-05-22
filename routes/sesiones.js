const express = require('express');
const router = express.Router();
const { pool, findOrCreateAula, findOrCreateInstructor, findOrCreateMunicipio, getSessionById } = require('../db');
const { getHolidayLabel } = require('../lib/holidays');

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

async function buildSessionsQuery(filters = {}) {
  const params = [];
  let sql = `
    SELECT
      p.id,
      a.placa,
      p.fecha_inicio AS fecha,
      p.fecha_fin,
      p.hora_ini,
      p.hora_fin,
      p.horas,
      p.programa,
      p.ficha,
      m.nombre AS municipio,
      p.ambiente,
      i.nombre AS instructor,
      COALESCE(p.conductor, c.nombre) AS conductor,
      p.situacion,
      p.trim,
      p.nivel,
      p.codigo,
      p.version,
      p.gastos,
      p.pendientes,
      p.aspirantes,
      p.observaciones,
      p.archivo_excel,
      p.horario,
      p.created_at,
      p.updated_at
    FROM programaciones p
    LEFT JOIN aulas_moviles a ON p.aula_id = a.id
    LEFT JOIN instructores i ON p.instructor_id = i.id
    LEFT JOIN municipios m ON p.municipio_id = m.id
    LEFT JOIN conductores c ON a.conductor_id = c.id
    WHERE 1=1`;

  if (filters.desde) {
    params.push(filters.desde);
    sql += ` AND p.fecha_inicio >= $${params.length}`;
  }
  if (filters.hasta) {
    params.push(filters.hasta);
    sql += ` AND p.fecha_inicio <= $${params.length}`;
  }
  if (filters.placa) {
    params.push(filters.placa);
    sql += ` AND LOWER(a.placa) = LOWER($${params.length})`;
  }
  sql += ' ORDER BY p.fecha_inicio, p.hora_ini';
  return { sql, params };
}

// GET /api/sesiones?desde=2026-01-01&hasta=2026-12-31&placa=OVE283
router.get('/', async (req, res) => {
  try {
    const { sql, params } = await buildSessionsQuery(req.query);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sesiones/:id
router.get('/:id', async (req, res) => {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'No encontrado' });
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sesiones
router.post('/', async (req, res) => {
  try {
    const f = req.body;
    const holidayLabel = getHolidayLabel(f.fecha);
    if (holidayLabel) {
      return res.status(400).json({ error: `No se puede programar en día festivo: ${holidayLabel}` });
    }

    const aulaId = await findOrCreateAula(f.placa || 'SIN AULA', f.conductor);
    const instructorId = await findOrCreateInstructor(f.instructor);
    const municipioId = await findOrCreateMunicipio(f.municipio);

    const { rows } = await pool.query(`
      INSERT INTO programaciones (
        aula_id, instructor_id, municipio_id, ficha, programa,
        fecha_inicio, fecha_fin, horario, observaciones, archivo_excel,
        hora_ini, hora_fin, horas, ambiente, conductor,
        situacion, trim, nivel, codigo, version, gastos, pendientes, aspirantes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
      ) RETURNING id`,
      [
        aulaId,
        instructorId,
        municipioId,
        f.ficha || null,
        f.programa || null,
        f.fecha || null,
        f.fecha || null,
        f.hora_ini && f.hora_fin ? `${f.hora_ini} - ${f.hora_fin}` : null,
        f.observaciones || null,
        f.archivo_excel || null,
        f.hora_ini || null,
        f.hora_fin || null,
        f.horas || null,
        f.ambiente || null,
        f.conductor || null,
        normalizeSituacion(f.situacion),
        f.trim || null,
        f.nivel || null,
        f.codigo || null,
        f.version || null,
        f.gastos || null,
        f.pendientes || null,
        f.aspirantes || null
      ]
    );
    const session = await getSessionById(rows[0].id);
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sesiones/:id
router.put('/:id', async (req, res) => {
  try {
    const f = req.body;
    const holidayLabel = getHolidayLabel(f.fecha);
    if (holidayLabel) {
      return res.status(400).json({ error: `No se puede programar en día festivo: ${holidayLabel}` });
    }

    const aulaId = await findOrCreateAula(f.placa || 'SIN AULA', f.conductor);
    const instructorId = await findOrCreateInstructor(f.instructor);
    const municipioId = await findOrCreateMunicipio(f.municipio);

    const { rows } = await pool.query(`
      UPDATE programaciones SET
        aula_id=$1,
        instructor_id=$2,
        municipio_id=$3,
        ficha=$4,
        programa=$5,
        fecha_inicio=$6,
        fecha_fin=$7,
        horario=$8,
        observaciones=$9,
        archivo_excel=$10,
        hora_ini=$11,
        hora_fin=$12,
        horas=$13,
        ambiente=$14,
        conductor=$15,
        situacion=$16,
        trim=$17,
        nivel=$18,
        codigo=$19,
        version=$20,
        gastos=$21,
        pendientes=$22,
        aspirantes=$23,
        updated_at=NOW()
      WHERE id=$24 RETURNING id`,
      [
        aulaId,
        instructorId,
        municipioId,
        f.ficha || null,
        f.programa || null,
        f.fecha || null,
        f.fecha || null,
        f.hora_ini && f.hora_fin ? `${f.hora_ini} - ${f.hora_fin}` : null,
        f.observaciones || null,
        f.archivo_excel || null,
        f.hora_ini || null,
        f.hora_fin || null,
        f.horas || null,
        f.ambiente || null,
        f.conductor || null,
        normalizeSituacion(f.situacion),
        f.trim || null,
        f.nivel || null,
        f.codigo || null,
        f.version || null,
        f.gastos || null,
        f.pendientes || null,
        f.aspirantes || null,
        req.params.id
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const session = await getSessionById(req.params.id);
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/sesiones/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM programaciones WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
