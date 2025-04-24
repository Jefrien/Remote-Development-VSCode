# Remote Development for Visual Studio Code

Esta extensión permite la conexión remota a un servidor SFTP o SSH, optimizando tu productividad y manteniendo tu entorno de desarrollo limpio y eficiente.

## Características

* Conectarse a un servidor SFTP o SSH.
* Subir y descargar archivos.
* Gestionar carpetas remotas.
* Copiar y mover archivos y carpetas.
* Renombrar archivos y carpetas.
* Eliminar archivos y carpetas.
* Copiar la ruta de acceso de un archivo o carpeta.
* Visualizar el contenido de un archivo.
* Visualizar el contenido de una carpeta.

> Nota: No es necesario la descarga de todo el codigo fuente, cuando se selecciona un archivo este si se descarga de forma temporal en el dispositivo, por lo cual funciona con otras extensiones como que fuera local.

## Apoyame con una Donacion
<a href="https://www.buymeacoffee.com/jefrienalvn"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" height="40" width="150"></a>


<a href="https://www.buymeacoffee.com/jefrienalvn">
    <img src="https://github.com/user-attachments/assets/670c21ae-fccd-416d-b14b-34fe9d9c96bb" alt="Buy Me A Coffee" height="150" width="150">
</a>

## Configuración y Seguridad

La configuración de los servidores se encuentra en un archivo plano en formato JSON, es tu responsabilidad mantenerlo seguro.

## Problemas Conocidos

No he encontrado ningun problema conocido, pero si tienes alguna sugerencia, por favor, no dudes en [crear un issue](https://github.com/Jefrien/Remote-Development-VSCode/issues/new).

## Notas de la versión

Lanzamiento inicial
- Manejar Archivos (Crear, Renombrar, Eliminar, Subir, Editar)
- Manejar Carpetas (Crear, Renombrar, Eliminar)
- Subir Archivos
- Arreglo en funcion para crear los paths remotos en Windows


---

### TODO
- Agregar soporte para servidores FTP por el momento solo SFTP y SSH son soportados.

## Extras

* Para guardar y subir el archivo que tienes abierto usa (`Alt+Shift+Q`) en cualquier sistema operativo.
* La estructua de un servidor es la siguiente:
    * `name`: Nombre del servidor
    * `host`: Host del servidor
    * `port`: Puerto del servidor
    * `username`: Usuario del servidor
    * `password`: Contrasena del servidor
    * `path`: Ruta del servidor

#### Ejemplo:

```json
{
    "servers": [
        {
            "name": "Server SFTP/SSH Example 1",
            "host": "127.0.0.1",
            "username": "user_sftp",
            "password": "password_sftp",
            "port": 22,
            "path": "/"
        },
        {
            "name": "Server FTP Example 2",
            "host": "localhost",
            "username": "user_ftp",
            "password": "password_ftp",
            "port": 21,
            "path": "/public_html/"
        }
    ]
}
```
