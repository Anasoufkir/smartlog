const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        EventSource: 'readonly',
        FileReader: 'readonly',
        Worker: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        LogScope: 'writable'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    // constants.js is the one file that *declares* window.LogScope; every
    // other module just extends the object the global points to.
    files: ['js/constants.js'],
    rules: { 'no-redeclare': 'off' }
  },
  {
    files: ['local-log-service.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
    rules: {
      // Destructuring password_hash/salt out of a user record to build a "safe"
      // copy is the intended pattern here, not an oversight.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // These catch blocks deliberately fall through to the next JSON-parsing
      // strategy; there's nothing useful to do with the error itself.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
