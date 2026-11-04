import { describe, expect, it } from 'vitest';

import {
    ConfigError,
    envSource,
    fileSource,
    loadConfig,
    objectSource,
    redactConfig,
} from '../../src/config/index';

const schema = {
    token: { type: 'string', required: true, secret: true, env: 'BOT_TOKEN' },
    prefix: { type: 'string', default: '!' },
    port: { type: 'number', default: 3000, min: 1, max: 65535 },
    debug: { type: 'boolean', default: false },
} as const;

describe('config loader', () => {
    it('reads values from the environment', async () => {
        const config = await loadConfig(schema, [
            envSource('', { BOT_TOKEN: 'secret-token' }),
        ]);

        expect(config.values).toEqual({
            token: 'secret-token',
            prefix: '!',
            port: 3000,
            debug: false,
        });
    });

    it('reports the source each value came from', async () => {
        const config = await loadConfig(schema, [
            objectSource({ BOT_TOKEN: 'from-object' }, 'object'),
            envSource('', { BOT_TOKEN: 'from-env' }),
        ]);

        expect(config.origins['token']).toBe('object');
    });

    it('gives the earlier source precedence', async () => {
        const config = await loadConfig(schema, [
            envSource('', { BOT_TOKEN: 'from-env' }),
            objectSource({ token: 'from-object' }, 'object'),
        ]);

        expect(config.values['token']).toBe('from-env');
    });

    it('fails loudly when a required value is missing', async () => {
        await expect(loadConfig(schema, [envSource('', {})])).rejects.toThrow(
            ConfigError,
        );
    });

    it('coerces numbers and booleans', async () => {
        const config = await loadConfig(schema, [
            envSource('', {
                BOT_TOKEN: 'token',
                PORT: '8080',
                DEBUG: 'yes',
            }),
        ]);

        expect(config.values['port']).toBe(8080);
        expect(config.values['debug']).toBe(true);
    });

    it('rejects a number outside its bounds', async () => {
        await expect(
            loadConfig(schema, [
                envSource('', { BOT_TOKEN: 'token', PORT: '70000' }),
            ]),
        ).rejects.toThrow(ConfigError);
    });

    it('rejects a value that is not a number', async () => {
        await expect(
            loadConfig(schema, [
                envSource('', { BOT_TOKEN: 'token', PORT: 'abc' }),
            ]),
        ).rejects.toThrow(ConfigError);
    });

    it('reads values from a file', async () => {
        const config = await loadConfig(schema, [
            fileSource('./tests/config/fixtures/config.json'),
            envSource('', { BOT_TOKEN: 'from-env', PREFIX: '!' }),
        ]);

        expect(config.values['token']).toBe('from-file');
        expect(config.values['prefix']).toBe('?');
    });

    it('ignores a missing file', async () => {
        const config = await loadConfig(schema, [
            fileSource('./tests/config/fixtures/missing.json'),
            envSource('', { BOT_TOKEN: 'token' }),
        ]);

        expect(config.values['token']).toBe('token');
    });

    it('redacts secret values', async () => {
        const config = await loadConfig(schema, [
            envSource('', { BOT_TOKEN: 'secret-token' }),
        ]);

        const redacted = redactConfig(config, schema);

        expect(redacted['token']).toBe('***');
        expect(redacted['prefix']).toBe('!');
    });
});
