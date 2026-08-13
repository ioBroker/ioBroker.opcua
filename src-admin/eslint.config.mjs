import config, { reactConfig } from '@iobroker/eslint-config';

export default [
    ...config,
    ...reactConfig,
    {
        rules: {
            'no-new-func': 'warn',
            'no-extend-native': 'warn',
            'no-eval': 'warn',
        },
    },
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // the vite configuration is not part of the sources, it has its own tsconfig
        files: ['vite.config.ts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: ['./tsconfig.node.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            '@/no-duplicate-imports': 'error',
        },
    },
    {
        ignores: ['build/**/*', 'node_modules/**/*', 'src/serviceWorker.js'],
    },
];
