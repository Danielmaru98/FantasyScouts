# FantasyScout

Liga del Grupo Scout Ciudad del Sol 108. Cada participante gestiona una plantilla de monitores. El equipo recibe cada semana la suma de los puntos de los monitores que tenga fichados.

## Versión local en un archivo

Descarga [index.html](index.html) y ábrelo en el navegador con doble clic.

1. Añade las secciones en **Gestión → Secciones** y registra sus monitores en **Monitores**.
2. Inscribe a los mánagers en **Equipos**. Usa **Vista local** para elegir a cada mánager y guardar su plantilla en **Mi equipo**.
3. Vuelve a **Organización**, abre la semana y pulsa **Fijar plantillas** cuando empiece. Registra las aportaciones de los monitores en **Puntuaciones**.

La liga se guarda en el navegador desde el que abres el archivo. **Gestión → Copia** permite descargarla en JSON y cargarla en otro navegador. El archivo HTML se puede regenerar con `npm run build:offline`.

Puedes importar una copia del HTML anterior. Los participantes de aquella liga pasan también al registro de monitores, los fichajes elegidos forman la plantilla histórica y los puntos individuales se conservan.

## Arranque con servidor

La versión con servidor comparte las plantillas y los puntos mediante SQLite.

1. Usa Node.js 24.2 o posterior.
2. Copia el archivo de configuración.

   ~~~sh
   cp .env.example .env
   ~~~

3. En el archivo `.env`, configura `ADMIN_PASSWORD` con una clave de al menos 12 caracteres y `INVITE_CODE` con el código de inscripción de al menos 8 caracteres.
4. Arranca la aplicación.

   ~~~sh
   npm start
   ~~~

5. Abre [http://localhost:3000](http://localhost:3000) y entra por **Acceso de organización**. Comparte el código de inscripción con los mánagers.

Para que el grupo acceda desde sus dispositivos, ejecuta la aplicación en un servidor Node.js accesible con HTTPS. Usa `COOKIE_SECURE=1`, conserva `DATABASE_PATH` en almacenamiento persistente y configura `APP_ORIGIN` con la dirección pública si el proxy cambia la cabecera Host. Guarda una copia de seguridad de la base de datos con el proceso detenido o mediante la función de copia de SQLite.

## Organizar la liga

1. En **Gestión → Secciones**, añade las secciones del grupo. Tropa Jungla viene dada de alta. Registra los monitores por separado en **Monitores**.
2. Cada mánager inscribe su equipo y selecciona monitores en **Mi equipo**. El límite empieza en cinco monitores y se ajusta desde **Gestión → Equipos**.
3. En **Gestión → Semanas**, abre la semana y pulsa **Fijar plantillas** al empezar. Los cambios posteriores en el equipo se aplican a las siguientes semanas. Puedes añadir semanas al calendario.
4. En **Puntuaciones**, marca las aportaciones de cada monitor. La organización puede asignar un responsable de puntuación por sección. Pulsa **Cerrar semana** al terminar la revisión.

## Puntuación

| Aportación | Puntos |
| --- | ---: |
| Tarea acordada, incluida la preparación de actividades y materiales | 3 |
| Apoyo a otro monitor | 2 |
| Reto común | 2 |
| Mejora puesta en práctica | 1 |

Cada aportación cuenta en una sola categoría y cada monitor puede sumar por categoría una vez a la semana. Los mánagers pueden fichar monitores de cualquier sección y varios equipos pueden elegir al mismo monitor. La clasificación suma el resultado de cada plantilla semanal. Los equipos que empatan en el total comparten puesto.

## Pruebas

~~~sh
npm test
~~~

Las pruebas cubren los permisos por sección, el guardado de plantillas semanales, la clasificación, la migración de datos anteriores y el arranque del HTML sin red.
