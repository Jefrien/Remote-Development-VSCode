import path from "path";
import os from "os";
import crypto from "crypto";

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

    // make path relative if starts with / and only one /
    if (customPath.startsWith('/') && customPath.indexOf('/', 1) === -1) {
        customPath = customPath.substring(1);
    }

    return customPath;
}

export function assertRemotePath(requestedPath: string, basePath: string = '/') {
    if (typeof requestedPath !== 'string' || /[\u0000-\u001f\u007f]/.test(requestedPath)) {
        throw new Error('Invalid remote path');
    }

    const normalizedBase = basePath.replace(/\\/g, '/');
    const normalizedRequested = requestedPath.replace(/\\/g, '/');
    if ([normalizedBase, normalizedRequested].some(value => value.split('/').includes('..'))) {
        throw new Error('Remote path traversal is not allowed');
    }
    const root = path.posix.resolve('/', normalizedBase);
    const candidate = normalizedRequested === normalizedBase
        ? root
        : normalizedRequested.startsWith('/')
        ? path.posix.resolve('/', normalizedRequested)
        : path.posix.resolve(root, normalizedRequested);
    const rootPrefix = root === '/' ? '/' : `${root}/`;
    if (candidate !== root && !candidate.startsWith(rootPrefix)) {
        throw new Error('Remote path escapes the configured base directory');
    }
    return candidate;
}

export function isSafeRemoteName(name: string): boolean {
    return typeof name === 'string'
        && name.length > 0
        && name.length <= 255
        && !/[\u0000-\u001f\u007f\\/]/.test(name)
        && name !== '.'
        && name !== '..';
}

export function safeLocalRemotePath(root: string, remotePath: string): string {
    if (typeof remotePath !== 'string' || /[\u0000-\u001f\u007f]/.test(remotePath)) {
        throw new Error('Invalid remote filename');
    }

    const normalizedInput = remotePath.replace(/\\/g, '/');
    if (normalizedInput.split('/').includes('..')) {
        throw new Error('Remote filename traversal is not allowed');
    }
    const normalized = path.posix.normalize(`/${normalizedInput}`);
    const candidate = path.resolve(root, `.${normalized}`);
    const resolvedRoot = path.resolve(root);
    if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Remote filename escapes the temporary directory');
    }
    return candidate;
}

export function hostStorageId(host: string): string {
    return crypto.createHash('sha256').update(host).digest('hex').slice(0, 32);
}
