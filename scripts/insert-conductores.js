require('dotenv').config();
const { pool } = require('../db');

(async () => {
  // 1. Delete duplicate conductores (ids not referenced by aulas_moviles)
  const { rows: dups } = await pool.query(
    `SELECT c.id, c.nombre FROM conductores c
     LEFT JOIN aulas_moviles a ON a.conductor_id = c.id
     WHERE a.id IS NULL`
  );
  for (const d of dups) {
    await pool.query('DELETE FROM telefonos_conductor WHERE conductor_id = $1', [d.id]);
    await pool.query('DELETE FROM conductores WHERE id = $1', [d.id]);
    console.log('Eliminado duplicado:', d.nombre, '(id:', d.id + ')');
  }

  // 2. Update existing referenced conductors
  await pool.query(
    `UPDATE conductores SET nombre = 'ALEXANDER RAMIREZ ZULUAGA', cedula = '18515026', email = 'aramirezz@sena.edu.co'
     WHERE id = 8`
  );
  console.log('Actualizado: ALEXANDER RAMIREZ ZULUAGA (id: 8)');

  await pool.query(
    `UPDATE conductores SET nombre = 'HEBERT PATIÑO SALAZAR', cedula = '18504016', email = 'hpatinos@sena.edu.co'
     WHERE id = 6`
  );
  console.log('Actualizado: HEBERT PATIÑO SALAZAR (id: 6)');

  await pool.query(
    `UPDATE conductores SET nombre = 'MAURICIO CARDONA TRIVIÑO', cedula = '10115876', email = 'mcardona@sena.edu.co'
     WHERE id = 7`
  );
  console.log('Actualizado: MAURICIO CARDONA TRIVIÑO (id: 7)');

  // 3. Verify
  const { rows: final } = await pool.query('SELECT id, nombre, cedula, email FROM conductores ORDER BY id');
  console.log('\nConductores finales:');
  final.forEach(c => console.log('  id:', c.id, '|', c.nombre, '| CC:', c.cedula, '|', c.email));

  await pool.end();
  console.log('\nOK');
})().catch(e => { console.error(e.message); process.exit(1); });
