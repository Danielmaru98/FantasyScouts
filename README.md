# FantasyScout

Liga del Grupo Scout Ciudad del Sol 108. Cada participante gestiona una plantilla de monitores. El equipo recibe cada semana la suma de los puntos de los monitores que tenga fichados.

## Versión local en un archivo

Descarga [index.html](index.html) y ábrelo en el navegador con doble clic.

1. En la primera visita, crea tu equipo. FantasyScout abre **Alineación** y recuerda tu equipo en ese navegador. Si ya había un equipo en la liga local, puedes elegir **Usar un equipo guardado**.
2. Desde **Vista local → Organización**, introduce la contraseña acordada para añadir secciones, registrar monitores y gestionar semanas. También puedes entrar desde **Acceso de organización** en la pantalla inicial.
3. Vuelve a **Vista usuario** para fichar monitores o liberar plazas en **Alineación → Editar plantilla**. En Organización, pulsa **Fijar plantillas** al empezar una semana y registra los puntos en **Puntuaciones**.

El acceso de Organización en el HTML se valida en el navegador y se bloquea al salir o recargar. La versión con servidor usa credenciales y sesiones propias.

La liga se guarda en el navegador desde el que abres el archivo. **Gestión → Copia** permite descargarla en JSON y cargarla en otro navegador. El archivo HTML se puede regenerar con `npm run build:offline`.

En **Monitores**, puedes descargar el registro por separado. **Importar registro** añade los monitores que falten a partir de ese archivo o de una copia completa de FantasyScout.

El **Mercado** muestra el valor en euros de cada monitor. Los monitores parten de 1.000 € y Organización puede asignar otro importe al registrarlos o pulsar **Editar valor** en el registro. Las copias locales incluyen los valores.

Puedes importar una copia del HTML anterior. Los participantes de aquella liga pasan también al registro de monitores, los fichajes elegidos forman la plantilla histórica y los puntos individuales se conservan.

## Abrir en el móvil con GitHub Pages

1. En [Settings → Pages](https://github.com/Danielmaru98/FantasyScouts/settings/pages), selecciona **Deploy from a branch**, rama **main** y carpeta **/docs**.
2. Pulsa **Save** y, cuando termine la publicación, abre **Visit site** desde el móvil.

El plan de GitHub debe admitir Pages en repositorios privados. GitHub publica el sitio con acceso público en repositorios personales. La carpeta de publicación contiene el HTML de la liga. En cada navegador, los registros se guardan localmente.

Para llevar tu liga al móvil, descarga una copia en **Gestión → Copia** en el navegador original e impórtala desde esa misma sección en el móvil. Al regenerar el HTML con `npm run build:offline`, se actualiza también la versión de Pages.

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
2. Cada mánager ve **Alineación** y **Clasificación**. En el campo puede consultar su plantilla actual o la que se fijó para una semana. En **Editar plantilla** puede buscar monitores por nombre o sección, consultar su valor y sus puntos, ficharlos o liberar plazas. El límite empieza en cinco monitores y se ajusta desde **Gestión → Equipos**.
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
