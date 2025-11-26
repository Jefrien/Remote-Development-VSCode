import path from "path";
import os from "os";

export function getTempDirectory() {
    // Process.env contiene las variables de entorno del sistema
    const tempDir = process.env.TEMP || // Windows
                    process.env.TMP || // Windows (alternativa)
                    process.env.TMPDIR || // macOS/Linux
                    os.tmpdir() || // Fallback usando el módulo os
                    path.join(os.homedir(), 'temp'); // Último fallback al directorio home

    // Asegurarse de que el path use el separador correcto para cada SO
    return path.normalize(tempDir);
}

export function pathServerFormat(path: string) {     
    let customPath = path.replace(/\\/g, '/');

    // make path relative
    if (customPath.startsWith('/')) {
        customPath = customPath.substring(1);
    }

    return customPath;
}
