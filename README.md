# FantasyScout

Liga de scouters del Grupo Scout Ciudad del Sol 108. Cada participante inscribe un equipo y elige dos fichajes por jornada. Los puntos y las alineaciones se comparten desde una base de datos SQLite.

## Arranque

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

5. Abre [http://localhost:3000](http://localhost:3000) y entra por **Acceso de organización**. Comparte el código de inscripción con los scouters.

Para que el grupo acceda desde sus dispositivos, ejecuta la aplicación en un servidor Node.js accesible con HTTPS. Usa `COOKIE_SECURE=1`, conserva `DATABASE_PATH` en almacenamiento persistente y configura `APP_ORIGIN` con la dirección pública si el proxy cambia la cabecera Host. Guarda una copia de seguridad de la base de datos con el proceso detenido o mediante la función de copia de SQLite.

## Organizar la liga

1. En **Gestión → Secciones**, añade las secciones del grupo. Tropa Jungla viene dada de alta.
2. Cada scouter se inscribe con su alias, su sección y el nombre de su equipo. Si quieres repartir el registro de puntos, asigna un responsable de puntuación a cada sección.
3. En **Gestión → Jornadas**, pon fecha al reto y abre el plazo de fichajes. Pulsa **Cerrar fichajes** cuando empiece la jornada.
4. En **Puntuaciones**, marca las aportaciones confirmadas. Cada sección puede registrarlas con la cuenta de su responsable. Pulsa **Cerrar jornada** al terminar la revisión.

## Puntuación

| Aportación | Puntos |
| --- | ---: |
| Tarea acordada, incluida la preparación de actividades y materiales | 3 |
| Apoyo a otro scouter | 2 |
| Reto común | 2 |
| Mejora puesta en práctica | 1 |

Cada aportación cuenta en una sola categoría y cada categoría puntúa una vez por jornada. Cada equipo incluye al mánager y a dos scouters distintos, con al menos un fichaje de otra sección. Los equipos pueden compartir fichajes. El total de un equipo es la suma de los puntos propios de las tres personas. Si falta la alineación, el equipo conserva los puntos del mánager. En empate tienen prioridad los puntos propios del mánager y, si también coinciden, los equipos comparten puesto.

## Pruebas

~~~sh
npm test
~~~

Las pruebas cubren la inscripción y los permisos, las reglas de fichajes, el cierre de jornadas, los desempates y la persistencia tras reiniciar.
