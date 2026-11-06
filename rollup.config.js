import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import babel from '@rollup/plugin-babel';

const plugins = [
  resolve({
    browser: true,
    preferBuiltins: false,
    extensions: ['.ts', '.js'],
  }),
  commonjs(),
  babel({
    babelHelpers: 'bundled',
    extensions: ['.js', '.ts'],
    exclude: 'node_modules/**',
  }),
  terser({
    compress: {
      drop_console: false,
    },
  }),
];

const outputs = {
  cjs: {
    file: 'dist/index.cjs.js',
    format: 'cjs',
    exports: 'auto',
    sourcemap: true,
  },
  esm: {
    file: 'dist/index.esm.js',
    format: 'esm',
    sourcemap: true,
  },
  umd: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'WeniWebchatService',
    sourcemap: true,
    globals: {
      eventemitter3: 'EventEmitter',
    },
  },
};

export default [
  {
    input: 'src/index.js',
    output: [outputs.cjs, outputs.esm],
    external: ['eventemitter3', 'libphonenumber-js/max'],
    plugins,
  },
  {
    input: 'src/index.js',
    output: [outputs.umd],
    external: ['eventemitter3'],
    plugins,
  },
];
