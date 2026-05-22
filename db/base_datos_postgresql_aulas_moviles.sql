
-- =====================================================
-- BASE DE DATOS - AULAS MOVILES (POSTGRESQL)
-- Diseño profesional inicial
-- =====================================================

-- =====================================================
-- TABLA: conductores
-- =====================================================

CREATE TABLE conductores (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    cedula VARCHAR(50) UNIQUE,
    email VARCHAR(150),
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABLA: telefonos_conductor
-- Un conductor puede tener múltiples teléfonos
-- =====================================================

CREATE TABLE telefonos_conductor (
    id BIGSERIAL PRIMARY KEY,

    conductor_id BIGINT NOT NULL,
    telefono VARCHAR(30) NOT NULL,
    tipo VARCHAR(50),

    FOREIGN KEY (conductor_id)
    REFERENCES conductores(id)
    ON DELETE CASCADE
);

-- =====================================================
-- TABLA: aulas_moviles
-- Cada aula tiene un conductor fijo
-- =====================================================

CREATE TABLE aulas_moviles (
    id BIGSERIAL PRIMARY KEY,

    placa VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(150),
    marca VARCHAR(100),
    modelo VARCHAR(100),
    capacidad INTEGER,

    conductor_id BIGINT UNIQUE NOT NULL,

    estado VARCHAR(50) DEFAULT 'disponible',

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (conductor_id)
    REFERENCES conductores(id)
);

-- =====================================================
-- TABLA: instructores
-- =====================================================

CREATE TABLE instructores (
    id BIGSERIAL PRIMARY KEY,

    nombre VARCHAR(150) NOT NULL,
    cedula VARCHAR(50),
    email VARCHAR(150),
    telefono VARCHAR(30),

    regional VARCHAR(100),

    estado VARCHAR(50) DEFAULT 'activo',

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABLA: municipios
-- =====================================================

CREATE TABLE municipios (
    id BIGSERIAL PRIMARY KEY,

    nombre VARCHAR(150) NOT NULL,
    departamento VARCHAR(150),

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABLA: sedes
-- =====================================================

CREATE TABLE sedes (
    id BIGSERIAL PRIMARY KEY,

    nombre VARCHAR(150) NOT NULL,
    direccion TEXT,

    municipio_id BIGINT,

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (municipio_id)
    REFERENCES municipios(id)
);

-- =====================================================
-- TABLA: programaciones
-- Información tomada desde Excel o manualmente
-- =====================================================

CREATE TABLE programaciones (
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

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (aula_id)
    REFERENCES aulas_moviles(id),

    FOREIGN KEY (instructor_id)
    REFERENCES instructores(id),

    FOREIGN KEY (municipio_id)
    REFERENCES municipios(id),

    FOREIGN KEY (sede_id)
    REFERENCES sedes(id)
);

-- =====================================================
-- ÍNDICES (MEJORAN RENDIMIENTO)
-- =====================================================

CREATE INDEX idx_programaciones_fecha_inicio
ON programaciones(fecha_inicio);

CREATE INDEX idx_programaciones_aula
ON programaciones(aula_id);

CREATE INDEX idx_programaciones_instructor
ON programaciones(instructor_id);

-- =====================================================
-- DATOS DE EJEMPLO
-- =====================================================

INSERT INTO conductores (nombre)
VALUES ('Hebert');

INSERT INTO telefonos_conductor (
    conductor_id,
    telefono,
    tipo
)
VALUES
(1, '3001111111', 'personal'),
(1, '3112222222', 'whatsapp');

INSERT INTO aulas_moviles (
    placa,
    nombre,
    conductor_id
)
VALUES (
    'OJA144',
    'Aula Movil 1',
    1
);

-- =====================================================
-- CONSULTA DE EJEMPLO
-- =====================================================

/*
SELECT
    a.placa,
    a.nombre AS aula,
    c.nombre AS conductor
FROM aulas_moviles a
JOIN conductores c
ON a.conductor_id = c.id;
*/
