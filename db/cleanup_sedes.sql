-- cleanup_sedes.sql
-- Script seguro para auditar y (opcionalmente) eliminar la tabla `sedes` y la columna `sede_id` en `programaciones`.
-- INSTRUCCIONES:
-- 1) Hacer backup de la base de datos antes de ejecutar.
-- 2) Ejecutar en un entorno de pruebas primero.
-- 3) Revisar los SELECTs para confirmar conteos.

-- Mostrar conteos básicos
SELECT 'count_sedes' AS "key", count(*) FROM sedes;
SELECT 'programaciones_con_sede' AS "key", count(*) FROM programaciones WHERE sede_id IS NOT NULL;

-- Listar algunas referencias (muestra limitada)
SELECT id, sede_id FROM programaciones WHERE sede_id IS NOT NULL LIMIT 50;

-- Crear respaldos de datos críticos (tablas de respaldo)
CREATE TABLE IF NOT EXISTS backup_sedes AS TABLE sedes WITH NO DATA;
INSERT INTO backup_sedes SELECT * FROM sedes;

CREATE TABLE IF NOT EXISTS backup_programaciones_sedes AS SELECT * FROM programaciones WHERE sede_id IS NOT NULL;

-- Si decides eliminar referencias: primero quitar la FK si existe.
DO $$
DECLARE
  c text;
BEGIN
  SELECT tc.constraint_name INTO c
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'programaciones'
    AND kcu.column_name = 'sede_id'
  LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE programaciones DROP CONSTRAINT %I', c);
    RAISE NOTICE 'Dropped constraint: %', c;
  ELSE
    RAISE NOTICE 'No foreign key constraint found for programaciones(sede_id)';
  END IF;
END$$;

-- Opción A (conservadora): eliminar valores y mantener columna
-- UPDATE programaciones SET sede_id = NULL WHERE sede_id IS NOT NULL;
-- COMMIT; -- si lo ejecutas dentro de una transacción manual

-- Opción B (eliminar columna y tabla `sedes`) - ejecutar solo si confirmas que no se usarán
-- ALTER TABLE programaciones DROP COLUMN IF EXISTS sede_id;
-- DROP TABLE IF EXISTS sedes;

-- Nota: las líneas de Opción B están comentadas por seguridad. Descomenta y ejecuta cuando estés 100% seguro.

-- Fin del script
