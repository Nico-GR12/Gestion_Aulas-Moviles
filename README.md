# Aulas Móviles SENA

## Stack
- **Backend**: Node.js + Express
- **DB**: PostgreSQL (Aiven)
- **Frontend**: HTML/CSS/JS estático (servido por Express)
- **Deploy**: Railway

---

## Despliegue en Aiven + Railway

### 1. Base de datos en Aiven
1. Crear servicio **PostgreSQL** en [aiven.io](https://aiven.io)
2. Copiar la **Service URI** (connection string completa)
3. El formato es: `postgresql://user:pass@host:port/dbname?sslmode=require`

> Si tu servidor usa certificado autofirmado, añade `DB_SSL=true` en el `.env` para aceptar la conexión.

### 2. Deploy en Railway
1. Subir el proyecto a GitHub
2. En Railway: **New Project → Deploy from GitHub repo**
3. En **Variables** agregar:
   ```
   DATABASE_URL=<tu Service URI de Aiven>
   PORT=3000
   ```
4. Railway detecta automáticamente el `package.json` y ejecuta `npm start`

### 3. Uso
- Acceder a la URL que Railway asigna
- Usar **Importar Excel** para cargar el archivo de programación de instructores
- El calendario muestra las 4 aulas: OBG466, OVE283, OVE265, OJA144
- Click en cualquier día para ver sesiones del día en el panel lateral
- Crear/editar/eliminar sesiones manualmente

---

## Desarrollo local

Si usas PostgreSQL local, crea una base de datos y configura el `.env`:

```bash
npm install
cp .env.example .env
# Crea la base de datos localmente
createdb aulas_moviles
# O con psql:
# psql -c "CREATE DATABASE aulas_moviles;"

# Edita .env con tu DATABASE_URL local, por ejemplo:
# DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/aulas_moviles

npm run dev
```

Si prefieres crear la tabla manualmente, usa el archivo `db/schema.sql`:

```bash
psql $(cat .env | grep DATABASE_URL | cut -d '=' -f2) -f db/schema.sql
```

Abrir http://localhost:3000
