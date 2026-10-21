import path from "path";
import os from "os";
import crypto from "crypto";
import type { ServerItem } from "../types";

export function assertUniqueServerIds(servers: Pick<ServerItem, 'id'>[]): void {
    const ids = new Set<string>();
    for (const server of servers) {
        if (server.id && ids.has(server.id)) {
            throw new Error(`Duplicate server ID: ${server.id}`);
        }
        if (server.id) {
            ids.add(server.id);
        }
    }
}

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

export function pathServerFormat(remotePath: string, protocol: 'ftp' | 'sftp' = 'sftp') {
    const normalized = remotePath.replace(/\\/g, '/');

    // SFTP paths are POSIX paths and must remain absolute. In particular, `/`
    // must not become an empty string (which means "current directory").
    if (protocol === 'sftp') {
        return normalized.startsWith('/') ? normalized || '/' : `/${normalized}`;
    }

    // FTP clients operate relative to the authenticated FTP root. Strip only
    // the leading slash, consistently for root and nested paths.
    return normalized === '/' ? '' : normalized.replace(/^\/+/, '');
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
