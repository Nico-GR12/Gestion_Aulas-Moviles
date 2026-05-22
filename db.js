const { Pool } = require('pg');

const rawConnectionString = process.env.DATABASE_URL;
const shouldUseSsl = rawConnectionString && (
  rawConnectionString.includes('sslmode=require') ||
  rawConnectionString.includes('sslmode=prefer') ||
  rawConnectionString.includes('sslmode=verify-ca') ||
  rawConnectionString.includes('sslmode=verify-full')
);

const ssl = process.env.DB_SSL === 'false' ? false
  : process.env.DB_SSL === 'true' ? { rejectUnauthorized: false }
  : shouldUseSsl ? { rejectUnauthorized: false }
  : false;

function sanitizeConnectionString(conn) {
  if (!conn) return conn;
  try {
    const url = new URL(conn);
    if (url.searchParams.has('sslmode')) {
      url.searchParams.delete('sslmode');
    }
    return url.toString();
  } catch (err) {
    return conn.replace(/([?&])sslmode=[^&]+(&|$)/, (match, p1, p2) => p2 ? p1 : '');
  }
}

const connectionString = ssl ? sanitizeConnectionString(rawConnectionString) : rawConnectionString;
const pool = new Pool({
  connectionString,
  ssl
});

function normalizeText(value) {
  return String(value || '').trim();
}

async function findOrCreateConductor(nombre, telefono) {
  const text = normalizeText(nombre);
  if (!text) return null;

  const { rows: existing } = await pool.query(
    'SELECT id FROM conductores WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
    [text]
  );
  const conductorId = existing[0] ? existing[0].id : null;

  if (conductorId) {
    if (telefono) {
      await pool.query(
        `INSERT INTO telefonos_conductor(conductor_id, telefono, tipo)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM telefonos_conductor WHERE conductor_id = $1 AND telefono = $2
         )`,
        [conductorId, String(telefono).trim(), 'principal']
      );
    }
    return conductorId;
  }

  const { rows: created } = await pool.query(
    'INSERT INTO conductores(nombre) VALUES ($1) RETURNING id',
    [text]
  );
  const newConductorId = created[0].id;
  if (telefono) {
    await pool.query(
      `INSERT INTO telefonos_conductor(conductor_id, telefono, tipo)
       VALUES ($1, $2, $3)`,
      [newConductorId, String(telefono).trim(), 'principal']
    );
  }
  return newConductorId;
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conductores (
      id BIGSERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      cedula VARCHAR(50) UNIQUE,
      email VARCHAR(150),
      activo BOOLEAN DEFAULT TRUE,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telefonos_conductor (
      id BIGSERIAL PRIMARY KEY,
      conductor_id BIGINT NOT NULL,
      telefono VARCHAR(30) NOT NULL,
      tipo VARCHAR(50),
      FOREIGN KEY (conductor_id) REFERENCES conductores(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS aulas_moviles (
      id BIGSERIAL PRIMARY KEY,
      placa VARCHAR(20) UNIQUE NOT NULL,
      nombre VARCHAR(150),
      marca VARCHAR(100),
      modelo VARCHAR(100),
      capacidad INTEGER,
      conductor_id BIGINT UNIQUE NOT NULL,
      estado VARCHAR(50) DEFAULT 'disponible',
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conductor_id) REFERENCES conductores(id)
    );

    CREATE TABLE IF NOT EXISTS instructores (
      id BIGSERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      cedula VARCHAR(50),
      email VARCHAR(150),
      telefono VARCHAR(30),
      regional VARCHAR(100),
      estado VARCHAR(50) DEFAULT 'activo',
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS municipios (
      id BIGSERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      departamento VARCHAR(150),
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sedes (
      id BIGSERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      direccion TEXT,
      municipio_id BIGINT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (municipio_id) REFERENCES municipios(id)
    );

    CREATE TABLE IF NOT EXISTS programaciones (
      id BIGSERIAL PRIMARY KEY,
      aula_id BIGINT NOT NULL,
      instructor_id BIGINT NOT NULL,
      municipio_id BIGINT,
      sede_id BIGINT,
      ficha VARCHAR(50),
      programa TEXT,
      fecha_inicio DATE,
      fecha_fin DATE,
      horario VARCHAR(100),
      observaciones TEXT,
      archivo_excel TEXT,
      hora_ini VARCHAR(5),
      hora_fin VARCHAR(5),
      horas NUMERIC(4,1),
      ambiente TEXT,
      conductor VARCHAR(150),
      situacion VARCHAR(50) DEFAULT 'POR PROGRAMAR',
      trim VARCHAR(5),
      nivel VARCHAR(100),
      codigo VARCHAR(50),
      version VARCHAR(50),
      gastos VARCHAR(10),
      pendientes TEXT,
      aspirantes JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (aula_id) REFERENCES aulas_moviles(id),
      FOREIGN KEY (instructor_id) REFERENCES instructores(id),
      FOREIGN KEY (municipio_id) REFERENCES municipios(id),
      FOREIGN KEY (sede_id) REFERENCES sedes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_programaciones_fecha_inicio ON programaciones(fecha_inicio);
    CREATE INDEX IF NOT EXISTS idx_programaciones_fecha_fin ON programaciones(fecha_fin);
    CREATE INDEX IF NOT EXISTS idx_programaciones_aula ON programaciones(aula_id);
    CREATE INDEX IF NOT EXISTS idx_programaciones_instructor ON programaciones(instructor_id);

    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS hora_ini VARCHAR(5);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS hora_fin VARCHAR(5);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS horas NUMERIC(4,1);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS ambiente TEXT;
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS conductor VARCHAR(150);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS situacion VARCHAR(50) DEFAULT 'POR PROGRAMAR';
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS trim VARCHAR(5);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS nivel VARCHAR(100);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS version VARCHAR(50);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS gastos VARCHAR(10);
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS pendientes TEXT;
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS aspirantes JSONB;
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE programaciones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);
  console.log('DB inicializada');
}

async function findOrCreateAula(placa, conductorName, conductorPhone) {
  const normalizedPlaca = String(placa || 'SIN AULA').trim().toUpperCase() || 'SIN AULA';
  const { rows: existingAula } = await pool.query('SELECT id FROM aulas_moviles WHERE UPPER(placa) = $1', [normalizedPlaca]);
  if (existingAula[0]) return existingAula[0].id;

  const conductorLabel = conductorName && String(conductorName).trim()
    ? String(conductorName).trim()
    : `Sin conductor (${normalizedPlaca})`;

  let conductorId = await findOrCreateConductor(conductorLabel, conductorPhone);
  if (conductorId) {
    const { rows: existingAulaForConductor } = await pool.query(
      'SELECT id FROM aulas_moviles WHERE conductor_id = $1 LIMIT 1',
      [conductorId]
    );
    if (existingAulaForConductor[0]) {
      const { rows: alternate } = await pool.query(
        'INSERT INTO conductores(nombre) VALUES ($1) RETURNING id',
        [conductorLabel]
      );
      conductorId = alternate[0].id;
      if (conductorPhone) {
        await pool.query(
          `INSERT INTO telefonos_conductor(conductor_id, telefono, tipo)
           VALUES ($1, $2, $3)`,
          [conductorId, String(conductorPhone).trim(), 'principal']
        );
      }
    }
  }

  const { rows: createdAula } = await pool.query(
    'INSERT INTO aulas_moviles(placa,nombre,conductor_id) VALUES ($1,$2,$3) RETURNING id',
    [normalizedPlaca, `Aula ${normalizedPlaca}`, conductorId]
  );
  return createdAula[0].id;
}

async function findOrCreateInstructor(nombre) {
  const text = String(nombre || 'Sin instructor').trim();
  const { rows: existing } = await pool.query(
    'SELECT id FROM instructores WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
    [text]
  );
  if (existing[0]) return existing[0].id;
  const { rows: created } = await pool.query(
    'INSERT INTO instructores(nombre) VALUES ($1) RETURNING id',
    [text]
  );
  return created[0].id;
}

async function findOrCreateMunicipio(nombre) {
  const text = String(nombre || '').trim();
  if (!text) return null;
  const { rows: existing } = await pool.query(
    'SELECT id FROM municipios WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
    [text]
  );
  if (existing[0]) return existing[0].id;
  const { rows: created } = await pool.query(
    'INSERT INTO municipios(nombre) VALUES ($1) RETURNING id',
    [text]
  );
  return created[0].id;
}

async function getSessionById(id) {
  const { rows } = await pool.query(`
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
    WHERE p.id = $1
  `, [id]);
  return rows[0];
}

module.exports = {
  pool,
  initDB,
  findOrCreateAula,
  findOrCreateConductor,
  findOrCreateInstructor,
  findOrCreateMunicipio,
  getSessionById
};
