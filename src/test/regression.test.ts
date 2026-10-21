import * as assert from 'assert';
import {
    assertUniqueServerIds,
    assertRemotePath,
    pathServerFormat,
    safeLocalRemotePath,
} from '../utils';
import { isTransientConnectionError, resolveSftpAuthMethod } from '../controllers/ftp.controller';

suite('Remote path and connection regression tests', () => {
    test('keeps the configured SFTP root as /', () => {
        assert.strictEqual(assertRemotePath('/', '/'), '/');
        assert.strictEqual(pathServerFormat('/', 'sftp'), '/');
        assert.strictEqual(pathServerFormat('/folder', 'sftp'), '/folder');
    });

    test('formats FTP paths relative to the authenticated FTP root', () => {
        assert.strictEqual(pathServerFormat('/', 'ftp'), '');
        assert.strictEqual(pathServerFormat('/folder/file.txt', 'ftp'), 'folder/file.txt');
    });

    test('rejects paths outside the configured remote base', () => {
        assert.throws(
            () => assertRemotePath('/other', '/public'),
            /escapes the configured base directory/
        );
        assert.throws(() => assertRemotePath('../secret', '/public'), /traversal/);
        assert.strictEqual(assertRemotePath('/public/file.txt', '/public'), '/public/file.txt');
    });

    test('keeps downloaded files inside the extension temp directory', () => {
        assert.throws(
            () => safeLocalRemotePath('/tmp/remote-development', '/../../secret'),
            /traversal/
        );
    });

    test('recognizes transport failures for the reconnect retry', () => {
        assert.strictEqual(isTransientConnectionError(new Error('ECONNRESET')), true);
        assert.strictEqual(isTransientConnectionError(new Error('permission denied')), false);
        assert.strictEqual(isTransientConnectionError(new Error('unknown'), true, false), true);
        assert.strictEqual(isTransientConnectionError(new Error('unknown'), false, true), true);
    });

    test('resolves SFTP authentication methods', () => {
        assert.strictEqual(resolveSftpAuthMethod({ authMethod: 'password', privateKeyPath: '/tmp/key' }), 'password');
        assert.strictEqual(resolveSftpAuthMethod({ authMethod: 'privateKey' }), 'privateKey');
        assert.strictEqual(resolveSftpAuthMethod({ privateKeyPath: '/tmp/key' }), 'privateKey');
        assert.strictEqual(resolveSftpAuthMethod({}), 'password');
    });

    test('rejects duplicate server IDs', () => {
        assert.throws(
            () => assertUniqueServerIds([{ id: 'server-1' }, { id: 'server-1' }]),
            /Duplicate server ID/
        );
        assert.doesNotThrow(() => assertUniqueServerIds([{ id: 'server-1' }, {}, { id: 'server-2' }]));
    });
});
