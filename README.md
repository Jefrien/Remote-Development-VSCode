# Remote Development for VS Code

Gestiona archivos remotos desde VS Code, Cursor y otros editores compatibles con extensiones de VS Code. Permite conectarte por SFTP o FTPS, explorar carpetas, editar archivos y subir cambios.

## Funciones

- Conexiones SFTP/SSH y FTPS.
- Autenticación SFTP con contraseña o clave privada SSH.
- Verificación de huella del servidor SFTP.
- Explorador remoto de archivos y carpetas.
- Edición local de archivos remotos y subida de cambios.
- Subida de archivos locales desde el menú contextual.
- Crear, renombrar, eliminar y cambiar permisos.
- Soporte para enlaces simbólicos.
- Reconexión automática ante fallos temporales.
- Protección de la carpeta remota configurada.
- Contraseñas guardadas en VS Code SecretStorage.
- Idioma en inglés o español.

## Requisitos

- VS Code `1.94.0` o posterior, Cursor u otro editor compatible.
- Un servidor SFTP o FTPS accesible.
- Credenciales y puerto del servidor.
- Para autenticación por clave, la clave privada debe existir en el equipo local.

El FTP sin cifrado se rechaza. Para FTP seguro usa FTPS con `"ftpSecure": true`.

## Instalación desde un VSIX

1. Abre la paleta con `Ctrl+Shift+P` en Windows/Linux o `Cmd+Shift+P` en macOS.
2. Ejecuta **Extensions: Install from VSIX...**.
3. Selecciona el archivo `.vsix`.
4. Recarga la ventana cuando el editor lo solicite.

## Configuración rápida

1. Abre la vista **Remote Development** desde la barra lateral.
2. Pulsa el botón de configuración o ejecuta **Remote Development: Config**.
3. Administra las conexiones desde la interfaz: crea, edita o elimina servidores.
4. Usa **Open in JSON** si prefieres editar el JSON directamente.
5. Ejecuta **Remote Development: Choose Connection** y selecciona un servidor.

La interfaz y el editor JSON actualizan la misma configuración interna. Puedes
escribir la contraseña mientras editas; al guardar, la extensión la mueve a VS
Code SecretStorage y deja un marcador en el JSON persistente.

### Ejemplo SFTP

~~~
{
  "servers": [
    {
      "name": "Mi servidor SFTP",
      "host": "example.com",
      "username": "deploy",
      "password": "mi-contraseña",
      "port": 22,
      "path": "/",
      "type": "sftp"
    }
  ]
}
~~~

### Ejemplo FTPS

~~~
{
  "servers": [
    {
      "name": "Mi servidor FTPS",
      "host": "ftp.example.com",
      "username": "deploy",
      "password": "mi-contraseña",
      "port": 21,
      "path": "/public_html",
      "type": "ftp",
      "ftpSecure": true
    }
  ]
}
~~~

### Ejemplo SFTP con clave privada

~~~
{
  "servers": [
    {
      "name": "Mi servidor con SSH key",
      "host": "example.com",
      "username": "deploy",
      "authMethod": "privateKey",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "passphrase": "mi-passphrase",
      "port": 22,
      "path": "/",
      "type": "sftp"
    }
  ]
}
~~~

`privateKeyPath` apunta a una clave privada almacenada localmente. La extensión
lee la clave al conectar y no la copia al archivo de configuración. La
passphrase, igual que la contraseña, se guarda en VS Code SecretStorage al
guardar la configuración.

### Campos

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `name` | Sí | Nombre mostrado en la lista. |
| `host` | Sí | Dominio o IP del servidor. |
| `username` | Sí | Usuario de conexión. |
| `password` | No | Contraseña; se guarda en SecretStorage al guardar. |
| `authMethod` | No | `password` o `privateKey`; por defecto se infiere según los campos configurados. |
| `privateKeyPath` | No | Ruta local de la clave privada SSH; aplica a SFTP. Se puede usar en lugar de `password`. |
| `passphrase` | No | Passphrase de la clave privada; se guarda en SecretStorage. |
| `port` | Sí | Normalmente `22` para SFTP o `21` para FTPS. |
| `path` | Sí | Carpeta remota base. Usa `/` para la raíz. |
| `type` | No | `sftp` o `ftp`; por defecto es SFTP. |
| `ftpSecure` | FTPS | Debe ser `true` para una conexión segura. |
| `hostFingerprint` | No | Huella SFTP aprobada; normalmente se guarda automáticamente. |

En la primera conexión SFTP aparecerá la huella del servidor:

- **Allow once / Trust once**: acepta solo esta conexión.
- **Allow always / Trust always**: guarda la huella.
- **Cancel / Deny**: rechaza la conexión.

Si la huella cambia, la conexión se rechaza. Verifícala con el administrador del servidor antes de aceptarla.

## Flujo de trabajo

1. Conéctate con **Remote Development: Choose Connection**.
2. Expande las carpetas en **Servers**.
3. Haz clic en un archivo para descargarlo y abrirlo.
4. Edita y guarda el archivo normalmente.
5. Ejecuta **Remote Development: Save and Upload**.

La subida solo funciona con archivos abiertos desde el explorador remoto de la extensión. Un archivo local cualquiera no tiene una ruta remota asociada.

## Guardar y subir con teclado

| Sistema | Atajo |
| --- | --- |
| Windows | `Alt+Shift+Q` |
| Linux | `Alt+Shift+Q` |
| macOS | `Option+Shift+Q` |

El comando guarda el archivo activo y sube la versión guardada. Si el atajo entra en conflicto:

1. Abre **File > Preferences > Keyboard Shortcuts** en Windows/Linux o **Code/Cursor > Settings > Keyboard Shortcuts** en macOS.
2. Busca **Remote Development: Save and Upload**.
3. Selecciona **Change Keybinding** y define otra combinación.

También puedes ejecutar el comando desde la paleta con `Ctrl+Shift+P` o `Cmd+Shift+P`.

## Comandos útiles

Busca Remote Development en la paleta de comandos:

| Comando | Uso |
| --- | --- |
| **Choose Connection** | Cargar servidores y conectar. |
| **Config** | Abrir el administrador visual de conexiones. |
| **Save and Upload** | Guardar y subir el archivo remoto activo. |
| **Change Language** | Cambiar entre English y Español. |
| **Open Resource** | Abrir un archivo remoto seleccionado. |
| **Open Remote Folder** | Abrir una carpeta remota. |

Desde el menú contextual de **Servers** también puedes abrir, editar, subir, crear, renombrar, eliminar, copiar rutas y cambiar permisos.

## Idioma

La extensión sigue inicialmente el idioma de VS Code si es inglés o español. Para cambiarlo manualmente ejecuta:

~~~text
Remote Development: Change Language
~~~

Recarga la ventana para actualizar títulos, comandos y menús. La selección queda guardada.

## Solución de problemas

### `command not found`

Instala el VSIX más reciente y ejecuta **Developer: Reload Window**. Si continúa, desinstala la versión anterior, reinicia el editor e instala nuevamente el VSIX.

### `Host denied (verification failed)`

La huella fue rechazada o cambió. Verifícala con el administrador del servidor antes de aceptar una nueva.

### `Remote path escapes the configured base directory`

El elemento está fuera de la carpeta definida en `path`. Para usar la raíz:

~~~json
"path": "/"
~~~

### La conexión o subida falla

Revisa host, puerto, usuario, contraseña y protocolo. Para FTPS confirma `"ftpSecure": true`. La extensión intenta reconectar una vez ante fallos temporales; después vuelve a ejecutar **Save and Upload**.

## Desarrollo

Requisitos: Node.js 24 LTS y npm.

~~~bash
git clone https://github.com/Jefrien/Remote-Development-VSCode.git
cd Remote-Development-VSCode
npm ci
npm run compile
npm run lint
~~~

Presiona `F5` en VS Code para iniciar un Extension Development Host.

### Pruebas

~~~bash
npm test
~~~

La primera ejecución descarga el runtime definido en `.vscode-test.mjs`. La carpeta `.vscode-test/` es local y no debe subirse al repositorio.

### Crear un VSIX

~~~bash
fnm exec --using v24.14.0 npx --no-install vsce package
~~~

Antes de abrir un pull request:

~~~bash
npm run compile
npm run lint
npm test
git diff --check
~~~

## Estructura

~~~text
src/extension.ts                              Activación
src/controllers/config-manager.controller.ts  Configuración y SecretStorage
src/controllers/localization.controller.ts    Idioma manual
src/controllers/ftp.controller.ts             FTP/FTPS/SFTP
src/controllers/explorer.controller.ts        Explorador remoto
src/controllers/files.controller.ts           Archivos
src/controllers/directories.controller.ts     Carpetas
src/utils/index.ts                            Rutas y protecciones
l10n/                                          Traducciones
src/test/                                      Pruebas
~~~

## Contribuir

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de abrir un pull request. Usa las plantillas de GitHub para issues y solicitudes. Para seguridad, sigue [`SECURITY.md`](SECURITY.md) en lugar de abrir un issue público.

## Licencia

El proyecto se distribuye bajo [`LICENCE.txt`](LICENCE.txt).
